import {
  createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes,
} from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createChatRelay } from '../src/devices/chat-relay.mjs';
import { firebaseConfigFromGoogleServices } from '../src/devices/firestore-relay-adapter.mjs';
import { createChatLedger } from '../src/devices/chat-ledger.mjs';
import { createChatCrypto } from '../src/devices/chat-crypto.mjs';
import { createChatResponseStream } from '../src/devices/chat-response-stream.mjs';
import { createMonotonicUlid } from '../src/contracts/event-id.mjs';
import { encodeChatPayloadV2 } from '../src/contracts/chat-payload.mjs';
import { parseChatEvent } from '../src/contracts/chat.mjs';
import { decodeAssistantResponseFrame } from '../src/contracts/assistant-response-stream.mjs';

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

const fakeRealtimeStream = () => {
  const frames = [];
  return {
    frames,
    publishFrame: vi.fn(async (frame) => { frames.push(structuredClone(frame)); }),
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
    keyEpoch: () => 1,
  };
  const relay = createChatRelay({
    firestore,
    identity: { privateKey: pc.privateKey, publicKeySpki: pc.publicKeySpki },
    registry,
    epochKeyFor: () => epochKey,
    ledger: overrides.ledger ?? createChatLedger(),
    respond: overrides.respond ?? (async ({ text }) => `écho ${text}`),
    handleMedia: overrides.handleMedia ?? null,
    publicKeyFromSpki,
    realtimeStream: overrides.realtimeStream ?? null,
    realtimeOwnerId: overrides.realtimeOwnerId ?? null,
    clock: overrides.clock ?? Date.now,
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
  it('déchiffre, fait répondre Mina et dépose les trames chiffrées ordonnées', async () => {
    const respond = async ({ text, onDelta }) => {
      await onDelta('écho ');
      await onDelta(text);
      return `écho ${text}`;
    };
    const { relay, firestore, device, epochKey, pc } = buildRelay({ respond });
    relay.start();
    const document = relayedEvent({ device, epochKey, plaintext: 'salut Mina' });
    await firestore.deliver([document]);

    const replies = [...firestore.stored.values()].filter((entry) => entry.target === 'device');
    expect(replies).toHaveLength(4);
    // Le clair ne transite JAMAIS par Firebase.
    expect(JSON.stringify(replies)).not.toContain('salut Mina');
    expect(JSON.stringify(replies)).not.toContain('écho');

    const readBack = createChatCrypto({
      signingPrivateKey: device.privateKey,
      verifyPublicKey: pc.publicKey,
      epochKey,
    });
    const frames = replies.map((reply) => decodeAssistantResponseFrame(readBack.verifyAndDecryptBytes(reply)));
    expect(frames.map(({ type }) => type)).toEqual([
      'assistant.response.started', 'assistant.response.chunk', 'assistant.response.chunk',
      'assistant.response.completed',
    ]);
    expect(frames.map(({ sequence }) => sequence)).toEqual([0, 1, 2, 3]);
    expect(frames.every(({ sourceEventId }) => sourceEventId === document.eventId)).toBe(true);
    expect(new Set(frames.map(({ responseId }) => responseId)).size).toBe(1);
    expect(frames.at(-1).text).toBe('écho salut Mina');
    expect(replies.map(({ routingClass }) => routingClass)).toEqual(['stream', 'stream', 'stream', 'message']);
    expect(relay.status()).toMatchObject({ watching: true, handled: 1, rejected: 0 });
  });

  it('dépose seulement les chunks éphémères dans RTDB et garde les terminaux dans Firestore', async () => {
    const respond = async ({ text, onDelta }) => {
      await onDelta('écho ');
      await onDelta(text);
      return `écho ${text}`;
    };
    const realtimeStream = fakeRealtimeStream();
    const { relay, firestore, device, epochKey, pc } = buildRelay({
      respond,
      realtimeStream,
      realtimeOwnerId: 'owner-test',
    });
    relay.start();
    const document = relayedEvent({ device, epochKey, plaintext: 'salut Mina' });

    await firestore.deliver([document]);

    const firestoreReplies = [...firestore.stored.values()].filter((entry) => entry.target === 'device');
    expect(firestoreReplies).toHaveLength(2);
    const streamEnvelopes = realtimeStream.frames.map(({ ciphertext }) => parseChatEvent(
      JSON.parse(Buffer.from(ciphertext, 'base64').toString('utf8')),
    ));
    const readBack = createChatCrypto({
      signingPrivateKey: device.privateKey,
      verifyPublicKey: pc.publicKey,
      epochKey,
    });
    expect(streamEnvelopes.map((event) => decodeAssistantResponseFrame(readBack.verifyAndDecryptBytes(event))))
      .toMatchObject([
        { type: 'assistant.response.chunk', sequence: 1, text: 'écho ' },
        { type: 'assistant.response.chunk', sequence: 2, text: 'salut Mina' },
      ]);
    expect(realtimeStream.frames).toEqual(expect.arrayContaining([
      expect.objectContaining({ ownerId: 'owner-test', responseId: expect.any(String), sequence: 1 }),
      expect.objectContaining({ ownerId: 'owner-test', responseId: expect.any(String), sequence: 2 }),
    ]));
    expect(JSON.stringify(realtimeStream.frames)).not.toContain('écho');
  });

  it('retire la question relayée après avoir déposé la réponse', async () => {
    const { relay, firestore, device, epochKey } = buildRelay();
    relay.start();
    const document = relayedEvent({ device, epochKey });
    await firestore.deliver([document]);
    expect(firestore.remove).toHaveBeenCalledWith(document.eventId);
    expect(firestore.stored.has(document.eventId)).toBe(false);
  });

  it('envoie un chunk média vérifié au même handler et ne génère pas de réponse texte', async () => {
    const handleMedia = vi.fn(async () => {});
    const respond = vi.fn(async () => 'réponse texte interdite');
    const { relay, firestore, device, epochKey } = buildRelay({ handleMedia, respond });
    relay.start();
    const document = relayedEvent({
      device,
      epochKey,
      plaintext: encodeChatPayloadV2({
        type: 'media.chunk',
        meta: { mediaId: 'media-relay', index: 0 },
        binary: Buffer.from([1, 2]),
      }),
    });

    await firestore.deliver([document]);

    expect(handleMedia).toHaveBeenCalledWith(expect.objectContaining({ type: 'media.chunk' }));
    expect(respond).not.toHaveBeenCalled();
    expect(firestore.remove).toHaveBeenCalledWith(document.eventId);
  });

  it('conserve un document média quand son traitement échoue pour permettre une redélivrance', async () => {
    const handleMedia = vi.fn(async () => { throw new Error('media_temporairement_indisponible'); });
    const { relay, firestore, device, epochKey } = buildRelay({ handleMedia });
    relay.start();
    const document = relayedEvent({
      device,
      epochKey,
      plaintext: encodeChatPayloadV2({
        type: 'media.chunk',
        meta: { mediaId: 'media-retry', index: 0 },
        binary: Buffer.from([1, 2]),
      }),
    });

    await firestore.deliver([document]);

    expect(handleMedia).toHaveBeenCalledOnce();
    expect(firestore.remove).not.toHaveBeenCalledWith(document.eventId);
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

  it('refuse une époque de clé périmée comme le chemin direct', async () => {
    const respond = vi.fn(async () => 'réponse interdite');
    let knownKey = null;
    const { relay, firestore, device, epochKey } = buildRelay({
      registry: {
        isApproved: () => true,
        publicKeyOf: () => knownKey,
        keyEpoch: () => 2,
      },
      respond,
    });
    knownKey = device.publicKeySpki;
    relay.start();
    const document = relayedEvent({ device, epochKey, overrides: { keyEpoch: 1 } });

    await firestore.deliver([document]);

    expect(respond).not.toHaveBeenCalled();
    expect(firestore.remove).toHaveBeenCalledWith(document.eventId);
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
    const { relay, firestore, device, epochKey, pc } = buildRelay({ ledger, respond });
    relay.start();

    const document = relayedEvent({ device, epochKey, plaintext: 'question unique' });
    const direct = createChatResponseStream({ ledger, respond });
    const directFrames = [];
    await direct.deliver({
      sourceEventId: document.eventId, text: 'question unique', deviceId: 'device-samsung', threadId: 'thread-main',
    }, async (frame) => directFrames.push(frame));
    await firestore.deliver([document]);

    expect(respond).toHaveBeenCalledTimes(1);
    expect(directFrames.map(({ type }) => type)).toEqual(['assistant.response.started', 'assistant.response.completed']);
    const relayFrames = [...firestore.stored.values()]
      .filter((entry) => entry.target === 'device')
      .map((entry) => decodeAssistantResponseFrame(createChatCrypto({
        signingPrivateKey: device.privateKey, verifyPublicKey: pc.publicKey, epochKey,
      }).verifyAndDecryptBytes(entry)));
    expect(relayFrames.map(({ type }) => type)).toEqual(['assistant.response.started', 'assistant.response.completed']);
    expect(relay.status().handled).toBe(1);
  });

  it('dépose failed sans exposer l\'erreur fournisseur', async () => {
    const { relay, firestore, device, epochKey, pc } = buildRelay({
      respond: async () => { throw new Error('modèle indisponible'); },
    });
    relay.start();
    const document = relayedEvent({ device, epochKey });
    await firestore.deliver([document]);
    const replies = [...firestore.stored.values()].filter((entry) => entry.target === 'device');
    const readBack = createChatCrypto({
      signingPrivateKey: device.privateKey, verifyPublicKey: pc.publicKey, epochKey,
    });
    expect(JSON.stringify(replies)).not.toContain('modèle indisponible');
    const frames = replies.map((reply) => decodeAssistantResponseFrame(readBack.verifyAndDecryptBytes(reply)));
    expect(frames.map(({ type }) => type)).toEqual(['assistant.response.started', 'assistant.response.failed']);
    expect(frames.at(-1)).toMatchObject({ sourceEventId: document.eventId, sequence: 1, code: 'provider_unavailable' });
    expect(firestore.remove).toHaveBeenCalledWith(document.eventId);
  });

  it('conserve la question si sa trame failed ne peut pas être déposée', async () => {
    const firestore = fakeFirestore();
    firestore.put = vi.fn(async (document) => {
      if (document.routingClass === 'message') throw new Error('relay_write_failed');
      firestore.stored.set(document.eventId, document);
    });
    const { relay, device, epochKey } = buildRelay({
      firestore,
      respond: async () => { throw new Error('modèle indisponible'); },
    });
    relay.start();
    const document = relayedEvent({ device, epochKey });

    await firestore.deliver([document]);

    expect(firestore.remove).not.toHaveBeenCalledWith(document.eventId);
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
      authDomain: 'mina-vision.firebaseapp.com',
      projectId: 'mina-vision',
      messagingSenderId: '000000000000',
      storageBucket: 'mina-vision.firebasestorage.app',
    });
  });

  it('propage l’URL Realtime Database lorsque le projet en fournit une', () => {
    expect(firebaseConfigFromGoogleServices({
      ...googleServices,
      project_info: {
        ...googleServices.project_info,
        firebase_url: 'https://mina-vision-default-rtdb.europe-west1.firebasedatabase.app',
      },
    })).toMatchObject({
      databaseURL: 'https://mina-vision-default-rtdb.europe-west1.firebasedatabase.app',
    });
  });

  it('refuse un paquet absent plutôt que de renvoyer une configuration partielle', () => {
    expect(() => firebaseConfigFromGoogleServices(googleServices, 'fr.autre.app'))
      .toThrow('google_services_client_introuvable');
  });
});
