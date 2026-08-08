import { readFile } from 'node:fs/promises';
import {
  assertFails, assertSucceeds, initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  Timestamp, doc, getDoc, serverTimestamp, setDoc, updateDoc,
} from 'firebase/firestore';
import { ref as databaseRef, set as setRealtime } from 'firebase/database';
import { ref as storageRef, uploadBytes } from 'firebase/storage';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

describe('contrat local des règles Firebase du chat owner/device', () => {
  it('déclare les surfaces Emulator et les gardes owner/device fail-closed', async () => {
    const [firebaseJson, firestoreRules, indexes, databaseRules] = await Promise.all([
      read('firebase.json'),
      read('firebase/firestore.rules'),
      read('firestore.indexes.json'),
      read('database.rules.json'),
    ]);
    const config = JSON.parse(firebaseJson);

    expect(config.firestore).toMatchObject({
      rules: 'firebase/firestore.rules',
      indexes: 'firestore.indexes.json',
    });
    expect(config.database).toEqual({ rules: 'database.rules.json' });
    expect(config.emulators.database.port).toBe(9000);
    expect(JSON.parse(indexes)).toEqual({ indexes: [], fieldOverrides: [] });
    expect(databaseRules).toContain('activeDevices');
    expect(firestoreRules).toContain('function hasOwnerClaim(ownerId)');
    expect(firestoreRules).toContain('function isActiveDevice(ownerId)');
    expect(firestoreRules).toContain('match /owners/{ownerId}');
    expect(firestoreRules).toContain('match /devices/{deviceId}');
    expect(firestoreRules).toContain('match /syncState/current');
  });
});

const emulatorDescribe = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
const OWNER_ID = 'owner-test';
const DEVICE_ID = 'device-test';
const OWNER_UID = 'opaque-owner-uid';
const CLAIMS = Object.freeze({
  owner_id: OWNER_ID,
  device_id: DEVICE_ID,
  token_version: 1,
});

function validEnvelope(eventId = 'event-test') {
  const now = Date.now();
  return {
    version: 3,
    eventId,
    threadId: 'thread-test',
    senderDeviceId: DEVICE_ID,
    deviceSequence: 1,
    keyEpoch: 1,
    routingClass: 'message',
    createdAt: Timestamp.fromMillis(now),
    expiresAt: Timestamp.fromMillis(now + 60_000),
    payloadCiphertext: 'AQID',
    nonce: 'n'.repeat(16),
    authTag: 't'.repeat(16),
    signature: 's'.repeat(64),
  };
}

emulatorDescribe('règles Emulator owner/device du chat', () => {
  let testEnv;

  beforeAll(async () => {
    expect(process.env.FIRESTORE_EMULATOR_HOST).toBe('127.0.0.1:8080');
    expect(process.env.FIREBASE_AUTH_EMULATOR_HOST).toBe('127.0.0.1:9099');
    expect(process.env.FIREBASE_DATABASE_EMULATOR_HOST).toBe('127.0.0.1:9000');
    expect(process.env.FIREBASE_STORAGE_EMULATOR_HOST).toBe('127.0.0.1:9199');
    testEnv = await initializeTestEnvironment({
      projectId: 'mina-vision',
      firestore: { rules: await read('firebase/firestore.rules') },
      database: { rules: await read('database.rules.json') },
      storage: { rules: await read('firebase.storage.rules') },
    });
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const firestore = context.firestore();
      await setDoc(doc(firestore, `owners/${OWNER_ID}/devices/${DEVICE_ID}`), {
        authUid: OWNER_UID,
        revokedAt: null,
        tokenVersion: 1,
        capabilities: ['chat.read', 'chat.write', 'media.send'],
      });
      await setDoc(doc(firestore, `owners/${OWNER_ID}/syncState/current`), {
        highWatermark: 42,
        compactedThrough: 0,
      });
      await setRealtime(databaseRef(context.database()), {
        activeDevices: {
          [OWNER_ID]: {
            [DEVICE_ID]: {
              authUid: OWNER_UID,
              revokedAt: null,
              tokenVersion: 1,
            },
          },
        },
      });
    });
  });

  afterAll(async () => {
    await testEnv?.cleanup();
  });

  function ownerContext() {
    return testEnv.authenticatedContext(OWNER_UID, CLAIMS);
  }

  it('autorise seulement le device actif owner à lire et créer une enveloppe bornée', async () => {
    const owner = ownerContext();
    const firestore = owner.firestore();
    const event = doc(firestore, `owners/${OWNER_ID}/events/event-test`);

    await assertSucceeds(getDoc(doc(firestore, `owners/${OWNER_ID}/devices/${DEVICE_ID}`)));
    await assertSucceeds(setDoc(event, validEnvelope()));
    await assertFails(updateDoc(event, { payloadCiphertext: 'rewritten' }));
    await assertFails(setDoc(doc(firestore, `owners/${OWNER_ID}/events/event-extra`), {
      ...validEnvelope('event-extra'),
      plaintext: 'never accepted',
    }));
  });

  it('refuse owner, device et curseur qui ne correspondent pas exactement', async () => {
    const foreignOwner = testEnv.authenticatedContext('opaque-foreign-uid', {
      owner_id: 'other-owner',
      device_id: DEVICE_ID,
      token_version: 1,
    });
    const wrongDevice = testEnv.authenticatedContext('opaque-wrong-device-uid', {
      owner_id: OWNER_ID,
      device_id: 'other-device',
      token_version: 1,
    });
    const owner = ownerContext();

    await assertFails(getDoc(doc(foreignOwner.firestore(), `owners/${OWNER_ID}/syncState/current`)));
    await assertFails(setDoc(doc(wrongDevice.firestore(), `owners/${OWNER_ID}/events/event-wrong-device`), validEnvelope('event-wrong-device')));
    await assertSucceeds(setDoc(doc(owner.firestore(), `owners/${OWNER_ID}/cursors/${DEVICE_ID}`), {
      deviceId: DEVICE_ID,
      cloudSequence: 42,
      updatedAt: serverTimestamp(),
    }));
    await assertFails(setDoc(doc(owner.firestore(), `owners/${OWNER_ID}/cursors/${DEVICE_ID}`), {
      deviceId: DEVICE_ID,
      cloudSequence: 43,
      updatedAt: serverTimestamp(),
    }));
  });

  it('refuse un device révoqué, une version de token divergente ou une capability absente', async () => {
    const owner = ownerContext();
    const firestore = owner.firestore();
    const device = doc(firestore, `owners/${OWNER_ID}/devices/${DEVICE_ID}`);

    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), `owners/${OWNER_ID}/devices/${DEVICE_ID}`), {
        authUid: OWNER_UID,
        revokedAt: Timestamp.fromMillis(1),
        tokenVersion: 1,
        capabilities: ['chat.read', 'chat.write', 'media.send'],
      });
    });
    await assertFails(setDoc(doc(firestore, `owners/${OWNER_ID}/events/event-revoked`), validEnvelope('event-revoked')));

    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), `owners/${OWNER_ID}/devices/${DEVICE_ID}`), {
        authUid: OWNER_UID,
        revokedAt: null,
        tokenVersion: 2,
        capabilities: ['chat.read', 'chat.write', 'media.send'],
      });
    });
    await assertFails(setDoc(doc(firestore, `owners/${OWNER_ID}/events/event-token-version`), validEnvelope('event-token-version')));

    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), `owners/${OWNER_ID}/devices/${DEVICE_ID}`), {
        authUid: OWNER_UID,
        revokedAt: null,
        tokenVersion: 1,
        capabilities: ['chat.read'],
      });
    });
    await assertFails(setDoc(doc(firestore, `owners/${OWNER_ID}/events/event-capability`), validEnvelope('event-capability')));
    await assertFails(setDoc(device, { authUid: OWNER_UID }));
  });

  it('réserve les documents runtime, pairing et journal aux Functions/Admin', async () => {
    const firestore = ownerContext().firestore();

    await assertFails(setDoc(doc(firestore, `owners/${OWNER_ID}/eventRuntime/event-test`), { serverSequence: 1 }));
    await assertFails(setDoc(doc(firestore, `owners/${OWNER_ID}/syncLog/1`), { serverSequence: 1 }));
    await assertFails(setDoc(doc(firestore, `owners/${OWNER_ID}/syncState/current`), { highWatermark: 43 }));
    await assertFails(setDoc(doc(firestore, `owners/${OWNER_ID}/pairingSessions/session-test`), { state: 'forged' }));
  });

  it('préserve le backup historique tout en isolant Storage et la présence owner/device', async () => {
    const owner = ownerContext();
    const storage = owner.storage();
    const database = owner.database();
    const ciphertext = new Uint8Array([1, 2, 3]);

    await assertSucceeds(uploadBytes(
      storageRef(storage, `owners/${OWNER_ID}/chat/thread-test/attachments/attachment-test/0`),
      ciphertext,
      { contentType: 'application/octet-stream' },
    ));
    await assertSucceeds(uploadBytes(
      storageRef(storage, `owners/${OWNER_UID}/devices/${DEVICE_ID}/backup/probe`),
      ciphertext,
      { contentType: 'application/octet-stream' },
    ));
    await assertSucceeds(setRealtime(databaseRef(database, `presence/${OWNER_ID}/${DEVICE_ID}`), {
      updatedAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    }));

    const unpaired = testEnv.authenticatedContext('opaque-unpaired-uid', {
      owner_id: OWNER_ID,
      device_id: 'unpaired-device',
      token_version: 1,
    });
    await assertFails(uploadBytes(
      storageRef(unpaired.storage(), `owners/${OWNER_ID}/chat/thread-test/attachments/attachment-blocked/0`),
      ciphertext,
      { contentType: 'application/octet-stream' },
    ));
    await assertFails(setRealtime(databaseRef(unpaired.database(), `presence/${OWNER_ID}/unpaired-device`), {
      updatedAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    }));
  });
});
