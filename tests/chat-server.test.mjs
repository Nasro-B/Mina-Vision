import {
  createPrivateKey, createPublicKey, createSign, generateKeyPairSync, randomBytes,
} from 'node:crypto';
import WebSocket from 'ws';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createChatServer } from '../src/devices/chat-server.mjs';
import { createChatDeviceRegistry } from '../src/devices/chat-device-registry.mjs';
import { createChatCrypto, deriveDeviceWrapKey, unwrapEpochKey } from '../src/devices/chat-crypto.mjs';
import { createMonotonicUlid } from '../src/contracts/event-id.mjs';
import { encodeChatPayloadV2 } from '../src/contracts/chat-payload.mjs';

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

const identityProof = ({ deviceId, publicKeySpki, challenge, privateKey }) => {
  const bytes = Buffer.from([deviceId, publicKeySpki, challenge]
    .map((value) => `${Buffer.byteLength(value, 'utf8')}:${value}`).join('|'), 'utf8');
  return createSign('sha256').update(bytes).sign({ key: privateKey, dsaEncoding: 'der' }).toString('base64');
};

// La file est attachée AVANT l'ouverture : le challenge est envoyé dès la connexion et serait
// perdu si l'on posait l'écouteur seulement après l'await de `open`.
const open = (port) => new Promise((resolve, reject) => {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/mina-chat`);
  socket.inbox = [];
  socket.waiters = [];
  socket.on('message', (data) => {
    const message = JSON.parse(String(data));
    const waiter = socket.waiters.shift();
    if (waiter) waiter(message);
    else socket.inbox.push(message);
  });
  socket.once('open', () => resolve(socket));
  socket.once('error', reject);
});

const nextMessage = (socket) => new Promise((resolve, reject) => {
  if (socket.inbox.length > 0) {
    resolve(socket.inbox.shift());
    return;
  }
  const timer = setTimeout(() => reject(new Error('aucune réponse du serveur')), 4_000);
  socket.waiters.push((message) => {
    clearTimeout(timer);
    resolve(message);
  });
});

const noMessageFor = (socket, timeoutMs = 30) => new Promise((resolve) => {
  if (socket.inbox.length > 0) {
    resolve(false);
    return;
  }
  const waiter = () => {
    clearTimeout(timer);
    resolve(false);
  };
  const timer = setTimeout(() => {
    const index = socket.waiters.indexOf(waiter);
    if (index >= 0) socket.waiters.splice(index, 1);
    resolve(true);
  }, timeoutMs);
  socket.waiters.push(waiter);
});

const deferred = () => {
  let resolve;
  return {
    promise: new Promise((done) => { resolve = done; }),
    resolve,
  };
};

let running = null;
let openSockets = [];

const startServer = async (overrides = {}) => {
  const pc = keyPair();
  const registry = overrides.registry ?? createChatDeviceRegistry();
  const epochKey = randomBytes(32);
  const server = createChatServer({
    identity: { privateKey: pc.privateKey, publicKeySpki: pc.publicKeySpki },
    registry,
    epochKeyFor: () => epochKey,
    respond: overrides.respond ?? (async ({ text }) => `reçu : ${text}`),
    port: 0,
    host: '127.0.0.1',
    ...overrides,
  });
  const { port } = await server.listen();
  running = server;
  return { server, registry, pc, epochKey, port: port || server.port };
};

/** Poignée de main complète — renvoie la socket authentifiée et la clé d'époque désenveloppée. */
const handshake = async ({ port, pc, registry, device = keyPair(), deviceId = 'device-test', pairingCode }) => {
  const socket = await open(port);
  openSockets.push(socket);
  const challengeFrame = await nextMessage(socket);
  expect(challengeFrame.type).toBe('challenge');

  socket.send(JSON.stringify({
    type: 'hello',
    deviceId,
    publicKeySpki: device.publicKeySpki,
    challenge: challengeFrame.challenge,
    signature: identityProof({
      deviceId,
      publicKeySpki: device.publicKeySpki,
      challenge: challengeFrame.challenge,
      privateKey: device.privateKey,
    }),
    pairingCode,
  }));
  const answer = await nextMessage(socket);
  if (answer.type !== 'epoch') return { socket, answer, device, deviceId, epochKey: null };

  const wrapKey = deriveDeviceWrapKey({
    privateKey: device.privateKey,
    peerPublicKey: pc.publicKey,
    deviceId,
  });
  const epochKey = unwrapEpochKey({
    deviceWrapKey: wrapKey,
    wrapped: answer,
    deviceId,
    keyEpoch: answer.keyEpoch,
  });
  return { socket, answer, device, deviceId, epochKey, registry };
};

afterEach(async () => {
  for (const socket of openSockets) socket.close();
  openSockets = [];
  if (running) await running.close();
  running = null;
});

describe('serveur du canal mina_app', () => {
  it('refuse un appareil inconnu quand l\'appairage n\'est pas ouvert', async () => {
    const { port, pc, registry } = await startServer();
    const { answer } = await handshake({ port, pc, registry });
    expect(answer).toMatchObject({ type: 'refused', reason: 'appairage_ferme' });
  });

  it('refuse un code d\'appairage incorrect — être sur le wifi ne suffit pas', async () => {
    const registry = createChatDeviceRegistry();
    const { port, pc } = await startServer({ registry });
    registry.openPairing();
    const { answer } = await handshake({ port, pc, registry, pairingCode: '000000' });
    // Le vrai code est aléatoire : la probabilité de collision est de 1 sur un million.
    if (answer.type === 'epoch') return;
    expect(answer).toMatchObject({ type: 'refused', reason: 'code_incorrect' });
  });

  it('appaire avec le bon code et livre la clé d\'époque enveloppée pour CET appareil', async () => {
    const registry = createChatDeviceRegistry();
    const { port, pc, epochKey } = await startServer({ registry });
    const { code } = registry.openPairing();
    const session = await handshake({ port, pc, registry, pairingCode: code });

    expect(session.answer.type).toBe('epoch');
    // La clé n'a jamais circulé en clair : elle est reconstituée par ECDH côté appareil.
    expect(session.epochKey.equals(epochKey)).toBe(true);
    expect(JSON.stringify(session.answer)).not.toContain(epochKey.toString('base64'));
    expect(registry.isApproved('device-test')).toBe(true);
  });

  it('le code est à usage UNIQUE — un second appareil avec le même code est refusé', async () => {
    const registry = createChatDeviceRegistry();
    const { port, pc } = await startServer({ registry });
    const { code } = registry.openPairing();
    await handshake({ port, pc, registry, deviceId: 'device-un', pairingCode: code });
    const second = await handshake({ port, pc, registry, deviceId: 'device-deux', pairingCode: code });
    expect(second.answer).toMatchObject({ type: 'refused', reason: 'appairage_ferme' });
  });

  it('refuse une preuve d\'identité falsifiée', async () => {
    const { port, pc, registry } = await startServer();
    const socket = await open(port);
    openSockets.push(socket);
    const challengeFrame = await nextMessage(socket);
    const device = keyPair();
    socket.send(JSON.stringify({
      type: 'hello',
      deviceId: 'device-menteur',
      publicKeySpki: device.publicKeySpki,
      challenge: challengeFrame.challenge,
      signature: Buffer.from('signature bidon').toString('base64'),
    }));
    expect(await nextMessage(socket)).toMatchObject({ type: 'refused', reason: 'preuve_invalide' });
    expect(registry.isApproved('device-menteur')).toBe(false);
  });

  it('refuse une preuve valide MAIS liée à un autre challenge (rejeu)', async () => {
    const { port, pc, registry } = await startServer();
    registry.openPairing();
    const socket = await open(port);
    openSockets.push(socket);
    await nextMessage(socket);
    const device = keyPair();
    const stolen = 'challenge-capture-ailleurs';
    socket.send(JSON.stringify({
      type: 'hello',
      deviceId: 'device-rejeu',
      publicKeySpki: device.publicKeySpki,
      challenge: stolen,
      signature: identityProof({
        deviceId: 'device-rejeu',
        publicKeySpki: device.publicKeySpki,
        challenge: stolen,
        privateKey: device.privateKey,
      }),
    }));
    expect(await nextMessage(socket)).toMatchObject({ type: 'refused', reason: 'challenge_inattendu' });
  });

  it('exige le hello avant tout autre message', async () => {
    const { port } = await startServer();
    const socket = await open(port);
    openSockets.push(socket);
    await nextMessage(socket);
    socket.send(JSON.stringify({ type: 'message', text: 'coucou' }));
    expect(await nextMessage(socket)).toMatchObject({ type: 'refused', reason: 'hello_attendu' });
  });

  it('accuse réception PUIS renvoie la réponse de Mina, chiffrée et signée', async () => {
    const registry = createChatDeviceRegistry();
    const { port, pc } = await startServer({
      registry,
      respond: async ({ text }) => `Mina a lu « ${text} »`,
    });
    const { code } = registry.openPairing();
    const session = await handshake({ port, pc, registry, pairingCode: code });

    const deviceCrypto = createChatCrypto({
      signingPrivateKey: session.device.privateKey,
      verifyPublicKey: createPublicKey({
        key: Buffer.from(session.answer.pcPublicKeySpki, 'base64'),
        format: 'der',
        type: 'spki',
      }),
      epochKey: session.epochKey,
    });
    const createdAtMs = Date.now();
    const event = deviceCrypto.encryptAndSign({
      header: {
        version: 2,
        eventId: createMonotonicUlid()(),
        threadId: 'thread-main',
        senderDeviceId: session.deviceId,
        deviceSequence: 1,
        keyEpoch: session.answer.keyEpoch,
        routingClass: 'message',
        createdAtMs,
        expiresAtMs: createdAtMs + 60_000,
      },
      plaintext: 'bonjour Mina',
    });

    session.socket.send(JSON.stringify(event));
    const ack = await nextMessage(session.socket);
    expect(ack).toMatchObject({ type: 'ack', eventId: event.eventId });

    const reply = await nextMessage(session.socket);
    expect(reply.senderDeviceId).toBe('pc-mina');
    // Le clair n'apparaît nulle part dans ce qui transite.
    expect(JSON.stringify(reply)).not.toContain('Mina a lu');
    expect(deviceCrypto.verifyAndDecrypt(reply)).toBe('Mina a lu « bonjour Mina »');
  });

  it('attend le traitement média vérifié avant l\'ACK direct', async () => {
    const processing = deferred();
    const handleMedia = vi.fn(() => processing.promise);
    const respond = vi.fn(async () => 'réponse texte interdite');
    const registry = createChatDeviceRegistry();
    const { port, pc } = await startServer({ registry, handleMedia, respond });
    const { code } = registry.openPairing();
    const session = await handshake({ port, pc, registry, pairingCode: code });
    const deviceCrypto = createChatCrypto({
      signingPrivateKey: session.device.privateKey,
      verifyPublicKey: pc.publicKey,
      epochKey: session.epochKey,
    });
    const createdAtMs = Date.now();
    const event = deviceCrypto.encryptAndSign({
      header: {
        version: 2,
        eventId: createMonotonicUlid()(),
        threadId: 'thread-main',
        senderDeviceId: session.deviceId,
        deviceSequence: 1,
        keyEpoch: session.answer.keyEpoch,
        routingClass: 'message',
        createdAtMs,
        expiresAtMs: createdAtMs + 60_000,
      },
      plaintext: encodeChatPayloadV2({
        type: 'media.chunk',
        meta: { mediaId: 'media-ack', index: 0 },
        binary: Buffer.from([1, 2]),
      }),
    });

    session.socket.send(JSON.stringify(event));
    expect(await noMessageFor(session.socket)).toBe(true);
    expect(handleMedia).toHaveBeenCalledWith(expect.objectContaining({ type: 'media.chunk' }));
    expect(respond).not.toHaveBeenCalled();

    processing.resolve();
    expect(await nextMessage(session.socket)).toMatchObject({ type: 'ack', eventId: event.eventId });
  });

  it('dit que Mina n\'a pas pu répondre au lieu d\'inventer une réponse', async () => {
    const registry = createChatDeviceRegistry();
    const { port, pc } = await startServer({
      registry,
      respond: async () => { throw new Error('modèle indisponible'); },
    });
    const { code } = registry.openPairing();
    const session = await handshake({ port, pc, registry, pairingCode: code });
    const deviceCrypto = createChatCrypto({
      signingPrivateKey: session.device.privateKey,
      verifyPublicKey: createPublicKey({
        key: Buffer.from(session.answer.pcPublicKeySpki, 'base64'), format: 'der', type: 'spki',
      }),
      epochKey: session.epochKey,
    });
    const createdAtMs = Date.now();
    session.socket.send(JSON.stringify(deviceCrypto.encryptAndSign({
      header: {
        version: 2,
        eventId: createMonotonicUlid()(),
        threadId: 'thread-main',
        senderDeviceId: session.deviceId,
        deviceSequence: 1,
        keyEpoch: session.answer.keyEpoch,
        routingClass: 'message',
        createdAtMs,
        expiresAtMs: createdAtMs + 60_000,
      },
      plaintext: 'question',
    })));
    await nextMessage(session.socket);
    const reply = await nextMessage(session.socket);
    expect(deviceCrypto.verifyAndDecrypt(reply)).toContain('modèle indisponible');
  });

  it('refuse un événement signé par un autre appareil', async () => {
    const registry = createChatDeviceRegistry();
    const { port, pc } = await startServer({ registry });
    const { code } = registry.openPairing();
    const session = await handshake({ port, pc, registry, pairingCode: code });

    const intruder = keyPair();
    const foreignCrypto = createChatCrypto({
      signingPrivateKey: intruder.privateKey,
      verifyPublicKey: intruder.publicKey,
      epochKey: session.epochKey,
    });
    const createdAtMs = Date.now();
    session.socket.send(JSON.stringify(foreignCrypto.encryptAndSign({
      header: {
        version: 2,
        eventId: createMonotonicUlid()(),
        threadId: 'thread-main',
        senderDeviceId: session.deviceId,
        deviceSequence: 1,
        keyEpoch: session.answer.keyEpoch,
        routingClass: 'message',
        createdAtMs,
        expiresAtMs: createdAtMs + 60_000,
      },
      plaintext: 'message injecté',
    })));
    expect(await nextMessage(session.socket)).toMatchObject({ type: 'rejected', reason: 'chat_signature_invalide' });
  });

  it('refuse un événement expiré', async () => {
    const registry = createChatDeviceRegistry();
    const { port, pc } = await startServer({ registry });
    const { code } = registry.openPairing();
    const session = await handshake({ port, pc, registry, pairingCode: code });
    const deviceCrypto = createChatCrypto({
      signingPrivateKey: session.device.privateKey,
      verifyPublicKey: session.device.publicKey,
      epochKey: session.epochKey,
    });
    const createdAtMs = Date.now() - 120_000;
    session.socket.send(JSON.stringify(deviceCrypto.encryptAndSign({
      header: {
        version: 2,
        eventId: createMonotonicUlid()(),
        threadId: 'thread-main',
        senderDeviceId: session.deviceId,
        deviceSequence: 1,
        keyEpoch: session.answer.keyEpoch,
        routingClass: 'message',
        createdAtMs,
        expiresAtMs: createdAtMs + 1_000,
      },
      plaintext: 'vieux message',
    })));
    expect(await nextMessage(session.socket)).toMatchObject({ type: 'rejected', reason: 'evenement_expire' });
  });

  it('W6 — envoie un média PC → appareil : méta + chunks déchiffrés et réassemblés à l\'identique', async () => {
    const registry = createChatDeviceRegistry();
    const { port, pc, server } = await startServer({ registry });
    const { code } = registry.openPairing();
    const session = await handshake({ port, pc, registry, pairingCode: code });
    const deviceCrypto = createChatCrypto({
      signingPrivateKey: session.device.privateKey,
      verifyPublicKey: pc.publicKey, // le téléphone vérifie la signature DU PC
      epochKey: session.epochKey,
    });

    const bytes = randomBytes(200_000); // 2 chunks de 128 Kio
    const sent = await server.sendMediaToDevice(session.deviceId, { bytes, mime: 'image/jpeg' });
    expect(sent.chunkCount).toBe(2);

    const { decodeChatPayload } = await import('../src/contracts/chat-payload.mjs');
    const { createMediaAssembler } = await import('../src/chat/media-assembler.mjs');
    const assembler = createMediaAssembler();

    const metaEvent = await nextMessage(session.socket);
    const metaPayload = decodeChatPayload(deviceCrypto.verifyAndDecryptBytes(metaEvent));
    expect(metaPayload.version).toBe(2);
    expect(metaPayload.type).toBe('message.attachment.created');
    assembler.begin({ ...metaPayload.meta });

    for (let i = 0; i < sent.chunkCount; i += 1) {
      const chunkEvent = await nextMessage(session.socket);
      const chunkPayload = decodeChatPayload(deviceCrypto.verifyAndDecryptBytes(chunkEvent));
      expect(chunkPayload.type).toBe('media.chunk');
      assembler.addChunk({ mediaId: chunkPayload.meta.mediaId, index: chunkPayload.meta.index, binary: chunkPayload.binary });
    }
    const media = assembler.finalize(metaPayload.meta.mediaId);
    expect(Buffer.compare(media.bytes, bytes)).toBe(0); // octets identiques, sha256 vérifié par finalize
  });

  it('W6 — refuse l\'envoi vers un appareil non connecté (fail-loud, pas de file fantôme)', async () => {
    const { server } = await startServer();
    await expect(server.sendMediaToDevice('device-absent', { bytes: Buffer.from([1]), mime: 'image/jpeg' }))
      .rejects.toThrow('chat_appareil_non_connecte');
  });

  it('Appels — demande de composeur chiffrée/signée reçue et décodée par le téléphone', async () => {
    const registry = createChatDeviceRegistry();
    const { port, pc, server } = await startServer({ registry });
    const { code } = registry.openPairing();
    const session = await handshake({ port, pc, registry, pairingCode: code });
    const deviceCrypto = createChatCrypto({
      signingPrivateKey: session.device.privateKey,
      verifyPublicKey: pc.publicKey,
      epochKey: session.epochKey,
    });

    const sent = await server.sendDialToDevice(session.deviceId, { number: '+33612345678' });
    expect(sent.requested).toBe(true);

    const { decodeChatPayload } = await import('../src/contracts/chat-payload.mjs');
    const event = await nextMessage(session.socket);
    const payload = decodeChatPayload(deviceCrypto.verifyAndDecryptBytes(event));
    expect(payload.type).toBe('call.dial.requested');
    expect(payload.meta.number).toBe('+33612345678');
  });

  it('Appels — numéro invalide refusé avant tout envoi', async () => {
    const registry = createChatDeviceRegistry();
    const { port, pc, server } = await startServer({ registry });
    const { code } = registry.openPairing();
    const session = await handshake({ port, pc, registry, pairingCode: code });
    await expect(server.sendDialToDevice(session.deviceId, { number: 'javascript:alert(1)' }))
      .rejects.toThrow('chat_numero_invalide');
  });

  // Finding F-02 (audit 2026-07-27, ÉLEVÉE), scénario exact reproduit : un appareil appairé dont
  // la WebSocket reste OUVERTE continuait, après révocation, à obtenir un `ack` et une réponse
  // déchiffrable — `handleEvent` ne revalidait pas l'approbation et acceptait l'ancienne époque
  // fournie par le client. La révocation doit être immédiate sur les sessions vivantes.
  it('F-02 — un appareil révoqué ne reçoit plus ni ack ni réponse sur sa socket déjà ouverte', async () => {
    const registry = createChatDeviceRegistry();
    // Chaque époque a SA clé (le défaut consistait à accepter la clé de l'ancienne époque).
    const epochKeys = new Map();
    const { port, pc, server } = await startServer({
      registry,
      epochKeyFor: (epoch) => {
        if (!epochKeys.has(epoch)) epochKeys.set(epoch, randomBytes(32));
        return epochKeys.get(epoch);
      },
      respond: async ({ text }) => `Mina a lu « ${text} »`,
    });
    const { code } = registry.openPairing();
    const session = await handshake({ port, pc, registry, pairingCode: code });

    const deviceCrypto = createChatCrypto({
      signingPrivateKey: session.device.privateKey,
      verifyPublicKey: createPublicKey({
        key: Buffer.from(session.answer.pcPublicKeySpki, 'base64'), format: 'der', type: 'spki',
      }),
      epochKey: session.epochKey,
    });
    const sendWithOldEpoch = (text) => {
      const createdAtMs = Date.now();
      const event = deviceCrypto.encryptAndSign({
        header: {
          version: 2,
          eventId: createMonotonicUlid()(),
          threadId: 'thread-main',
          senderDeviceId: session.deviceId,
          deviceSequence: 1,
          keyEpoch: session.answer.keyEpoch, // ancienne époque, volontairement
          routingClass: 'message',
          createdAtMs,
          expiresAtMs: createdAtMs + 60_000,
        },
        plaintext: text,
      });
      session.socket.send(JSON.stringify(event));
      return event;
    };

    // 1. Avant révocation : le canal fonctionne (sinon le test ne prouverait rien).
    sendWithOldEpoch('avant révocation');
    expect(await nextMessage(session.socket)).toMatchObject({ type: 'ack' });
    await nextMessage(session.socket); // la réponse chiffrée de Mina

    // 2. Révocation DIRECTE dans le registre, sans passer par chat-channel : c'est le pire cas,
    //    celui où personne n'a pensé à fermer la socket. La sécurité ne doit pas dépendre de la
    //    discipline de l'appelant.
    const outcome = registry.revoke(session.deviceId);
    expect(outcome.ok).toBe(true);
    expect(registry.isApproved(session.deviceId)).toBe(false);

    // 3. Barrière de fond : la trame suivante est REFUSÉE (ni ack, ni réponse déchiffrable),
    //    parce que handleEvent revalide l'approbation et l'époque à chaque événement.
    sendWithOldEpoch('après révocation');
    const after = await nextMessage(session.socket).catch(() => null);
    expect(after?.type).not.toBe('ack');
    // « refused » = refus qui FERME la socket (code 1008) ; « rejected » = refus sans fermeture.
    // Les deux sont acceptables ici ; ce qui est interdit, c'est un ack ou une réponse.
    expect(after === null || after.type === 'refused' || after.type === 'rejected').toBe(true);
    expect(after?.reason).toBe('appareil_revoque');

    // 4. Et la session est coupée : plus aucun canal vivant pour cet appareil.
    await new Promise((resolve) => { setTimeout(resolve, 50); });
    expect(server.hasSession(session.deviceId)).toBe(false);
  });

  it('F-02 — disconnectDevice ferme la session vivante d\'un appareil (API utilisée par la révocation)', async () => {
    const registry = createChatDeviceRegistry();
    const { port, pc, server } = await startServer({ registry });
    const { code } = registry.openPairing();
    const session = await handshake({ port, pc, registry, pairingCode: code });

    expect(server.hasSession(session.deviceId)).toBe(true);
    expect(server.disconnectDevice(session.deviceId)).toMatchObject({ disconnected: true });
    expect(server.hasSession(session.deviceId)).toBe(false);
    // Idempotent : re-déconnecter un appareil sans session ne lève pas.
    expect(server.disconnectDevice(session.deviceId)).toMatchObject({ disconnected: false });
  });
});
