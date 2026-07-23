import {
  createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes,
} from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createChatRelay } from '../src/devices/chat-relay.mjs';
import { firebaseConfigFromGoogleServices } from '../src/devices/firestore-relay-adapter.mjs';
import { createChatLedger } from '../src/devices/chat-ledger.mjs';
import { createChatCrypto } from '../src/devices/chat-crypto.mjs';
import { createMonotonicUlid } from '../src/contracts/event-id.mjs';

const keyPair = () => {
  const pair = generateKeyPairSync('ec', {
    namedCurve: 'P-256',
    privateKeyEncoding: { type: 'pkcs8', format: 'der' },
    publicKeyEncoding: { type: 'spki', format: 'der' },
  });
  return {
    privateKey: createPrivateKey({ key: pair.privateKey, format: 'der', type: 'pkcs8' }),
    publicKey: createPublicKey({ key: pair.publicKey, format: 'der', type: 'spki' }),
    publicKeySpki: pair.publicKey.toString('base64'),
  };
};

const publicKeyFromSpki = (spki) => createPublicKey({
  key: Buffer.from(spki, 'base64'), format: 'der', type: 'spki',
});

/** Firestore simulé : garde ce qui est écrit, pour vérifier ce qui transite réellement. */
const fakeFirestore = () => {
  const stored = new Map();
  let handler = null;
  return {
    watch: vi.fn((_target, callback) => { handler = callback; return () => { handler = null; }; }),
    put: vi.fn(async (document) => { stored.set(document.eventId, document); }),
    remove: vi.fn(async (eventId) => { stored.delete(eventId); }),
    deliver: (documents) => handler(documents),
    stored,
    watching: () => handler !== null,
  };
};

const buildRelay = (overrides = {}) => {
  const pc = keyPair();
  const device = keyPair();
  const epochKey = randomBytes(32);
  const firestore = overrides.firestore ?? fakeFirestore();
  const registry = overrides.registry ?? {
    isApproved: (id) => id === 'device-samsung',
    publicKeyOf: () => device.publicKeySpki,
  };
  const relay = createChatRelay({
    firestore,
    identity: { privateKey: pc.privateKey, publicKeySpki: pc.publicKeySpki },
    registry,
    epochKeyFor: () => epochKey,
    ledger: overrides.ledger ?? createChatLedger(),
    respond: overrides.respond ?? (async ({ text }) => `écho ${text}`),
    publicKeyFromSpki,
    ulid: createMonotonicUlid(),
  });
  return { relay, firestore, pc, device, epochKey };
};

const relayedEvent = ({ device, epochKey, plaintext = 'bonjour', overrides = {} }) => {
  const crypto = createChatCrypto({
    signingPrivateKey: device.privateKey,
    verifyPublicKey: device.publicKey,
    epochKey,
  });
  const createdAtMs = Date.now();
  const event = crypto.encryptAndSign({
    header: {
      version: 2,
      eventId: createMonotonicUlid()(),
      threadId: 'thread-main',
      senderDeviceId: 'device-samsung',
      deviceSequence: 1,
      keyEpoch: 1,
      routingClass: 'message',
      createdAtMs,
      expiresAtMs: createdAtMs + 60_000,
      ...overrides,
    },
    plaintext,
  });
  return { ...event, target: 'pc', relayedAtMs: createdAtMs };
};

describe('relais Firebase du canal mina_app', () => {
  it('déchiffre, fait répondre Mina et dépose la réponse chiffrée', async () => {
    const { relay, firestore, device, epochKey, pc } = buildRelay();
    relay.start();
    await firestore.deliver([relayedEvent({ device, epochKey, plaintext: 'salut Mina' })]);

    const replies = [...firestore.stored.values()].filter((entry) => entry.target === 'device');
    expect(replies).toHaveLength(1);
    // Le clair ne transite JAMAIS par Firebase.
    expect(JSON.stringify(replies[0])).not.toContain('salut Mina');
    expect(JSON.stringify(replies[0])).not.toContain('écho');

    const readBack = createChatCrypto({
      signingPrivateKey: device.privateKey,
      verifyPublicKey: pc.publicKey,
      epochKey,
    });
    expect(readBack.verifyAndDecrypt(replies[0])).toBe('écho salut Mina');
    expect(relay.status()).toMatchObject({ watching: true, handled: 1, rejected: 0 });
  });

  it('retire la question relayée après avoir déposé la réponse', async () => {
    const { relay, firestore, device, epochKey } = buildRelay();
    relay.start();
    const document = relayedEvent({ device, epochKey });
    await firestore.deliver([document]);
    expect(firestore.remove).toHaveBeenCalledWith(document.eventId);
    expect(firestore.stored.has(document.eventId)).toBe(false);
  });

  it('refuse un document signé par un appareil étranger — Firebase n\'est pas de confiance', async () => {
    const { relay, firestore, epochKey } = buildRelay();
    relay.start();
    const intruder = keyPair();
    await firestore.deliver([relayedEvent({ device: intruder, epochKey, plaintext: 'injection' })]);

    expect([...firestore.stored.values()].filter((entry) => entry.target === 'device')).toHaveLength(0);
    expect(relay.status()).toMatchObject({ handled: 0, rejected: 1 });
  });

  it('refuse un appareil non approuvé même si sa signature est valide', async () => {
    const { relay, firestore, device, epochKey } = buildRelay({
      registry: { isApproved: () => false, publicKeyOf: () => null },
    });
    relay.start();
    await firestore.deliver([relayedEvent({ device, epochKey })]);
    expect(relay.status()).toMatchObject({ handled: 0, rejected: 1 });
  });

  it('refuse un événement expiré', async () => {
    const { relay, firestore, device, epochKey } = buildRelay();
    relay.start();
    const stale = Date.now() - 120_000;
    await firestore.deliver([relayedEvent({
      device, epochKey, overrides: { createdAtMs: stale, expiresAtMs: stale + 1_000 },
    })]);
    expect(relay.status()).toMatchObject({ handled: 0, rejected: 1 });
  });

  it('retire un document mal formé au lieu de boucler dessus', async () => {
    const { relay, firestore } = buildRelay();
    relay.start();
    await firestore.deliver([{ eventId: 'PAS-UN-ULID', target: 'pc' }]);
    expect(firestore.remove).toHaveBeenCalledWith('PAS-UN-ULID');
    expect(relay.status().rejected).toBe(1);
  });

  it('direct ET relais pour le MÊME message : Mina ne répond qu\'une fois', async () => {
    const ledger = createChatLedger();
    const respond = vi.fn(async ({ text }) => `réponse à ${text}`);
    const { relay, firestore, device, epochKey } = buildRelay({ ledger, respond });
    relay.start();

    const document = relayedEvent({ device, epochKey, plaintext: 'question unique' });
    // Le chemin direct a déjà traité cet eventId ; le relais le revoit.
    await ledger.once(document.eventId, () => respond({ text: 'question unique' }));
    await firestore.deliver([document]);

    expect(respond).toHaveBeenCalledTimes(1);
    expect(relay.status().handled).toBe(1);
  });

  it('dit que Mina n\'a pas pu répondre au lieu d\'inventer', async () => {
    const { relay, firestore, device, epochKey, pc } = buildRelay({
      respond: async () => { throw new Error('modèle indisponible'); },
    });
    relay.start();
    await firestore.deliver([relayedEvent({ device, epochKey })]);
    const reply = [...firestore.stored.values()].find((entry) => entry.target === 'device');
    const readBack = createChatCrypto({
      signingPrivateKey: device.privateKey, verifyPublicKey: pc.publicKey, epochKey,
    });
    expect(readBack.verifyAndDecrypt(reply)).toContain('modèle indisponible');
  });

  it('s\'arrête réellement — status() ne ment pas sur l\'écoute', async () => {
    const { relay, firestore } = buildRelay();
    relay.start();
    expect(relay.status().watching).toBe(true);
    relay.stop();
    expect(relay.status().watching).toBe(false);
    expect(firestore.watching()).toBe(false);
  });
});

describe('configuration Firebase depuis google-services.json', () => {
  const googleServices = {
    project_info: {
      project_id: 'mina-vision',
      project_number: '000000000000',
      storage_bucket: 'mina-vision.firebasestorage.app',
    },
    client: [{
      client_info: {
        mobilesdk_app_id: '1:000000000000:android:abc',
        android_client_info: { package_name: 'fr.mina.gateway' },
      },
      api_key: [{ current_key: 'CLE-CLIENT-ANDROID' }],
    }],
  };

  it('extrait exactement la configuration du bon paquet', () => {
    expect(firebaseConfigFromGoogleServices(googleServices)).toEqual({
      apiKey: 'CLE-CLIENT-ANDROID',
      appId: '1:000000000000:android:abc',
      projectId: 'mina-vision',
      messagingSenderId: '000000000000',
      storageBucket: 'mina-vision.firebasestorage.app',
    });
  });

  it('refuse un paquet absent plutôt que de renvoyer une configuration partielle', () => {
    expect(() => firebaseConfigFromGoogleServices(googleServices, 'fr.autre.app'))
      .toThrow('google_services_client_introuvable');
  });
});
