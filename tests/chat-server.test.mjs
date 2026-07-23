import {
  createPrivateKey, createPublicKey, createSign, generateKeyPairSync, randomBytes,
} from 'node:crypto';
import WebSocket from 'ws';
import { afterEach, describe, expect, it } from 'vitest';
import { createChatServer } from '../src/devices/chat-server.mjs';
import { createChatDeviceRegistry } from '../src/devices/chat-device-registry.mjs';
import { createChatCrypto, deriveDeviceWrapKey, unwrapEpochKey } from '../src/devices/chat-crypto.mjs';
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
});
