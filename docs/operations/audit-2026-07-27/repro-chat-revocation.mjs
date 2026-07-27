import assert from 'node:assert/strict';
import {
  createPrivateKey,
  createPublicKey,
  createSign,
  generateKeyPairSync,
  randomBytes,
} from 'node:crypto';
import WebSocket from 'ws';
import { createChatCrypto, deriveDeviceWrapKey, unwrapEpochKey } from '../../../src/devices/chat-crypto.mjs';
import { createChatDeviceRegistry } from '../../../src/devices/chat-device-registry.mjs';
import { createChatServer } from '../../../src/devices/chat-server.mjs';
import { createMonotonicUlid } from '../../../src/contracts/event-id.mjs';

function keyPair() {
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
}

function identityProof({ deviceId, publicKeySpki, challenge, privateKey }) {
  const bytes = Buffer.from([deviceId, publicKeySpki, challenge]
    .map((value) => `${Buffer.byteLength(value, 'utf8')}:${value}`).join('|'), 'utf8');
  return createSign('sha256').update(bytes)
    .sign({ key: privateKey, dsaEncoding: 'der' }).toString('base64');
}

function openSocket(port) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/mina-chat`);
    socket.auditInbox = [];
    socket.auditWaiters = [];
    socket.on('message', (data) => {
      const message = JSON.parse(String(data));
      const waiter = socket.auditWaiters.shift();
      if (waiter) waiter.resolve(message);
      else socket.auditInbox.push(message);
    });
    socket.once('open', () => resolve(socket));
    socket.once('error', reject);
  });
}

function nextMessage(socket) {
  if (socket.auditInbox.length > 0) return Promise.resolve(socket.auditInbox.shift());
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('audit_chat_response_timeout')), 4_000);
    socket.auditWaiters.push({
      resolve(message) {
        clearTimeout(timer);
        resolve(message);
      },
    });
  });
}

const registry = createChatDeviceRegistry();
const pc = keyPair();
const device = keyPair();
const deviceId = 'audit-device';
const epochKey = randomBytes(32);
let responseGenerated = 0;
const server = createChatServer({
  identity: { privateKey: pc.privateKey, publicKeySpki: pc.publicKeySpki },
  registry,
  epochKeyFor: () => epochKey,
  respond: async () => {
    responseGenerated += 1;
    return 'reponse-apres-revocation';
  },
  port: 0,
  host: '127.0.0.1',
});

let socket;
try {
  const { port } = await server.listen();
  socket = await openSocket(port);
  const challenge = await nextMessage(socket);
  const { code } = registry.openPairing();
  socket.send(JSON.stringify({
    type: 'hello',
    deviceId,
    publicKeySpki: device.publicKeySpki,
    challenge: challenge.challenge,
    signature: identityProof({
      deviceId,
      publicKeySpki: device.publicKeySpki,
      challenge: challenge.challenge,
      privateKey: device.privateKey,
    }),
    pairingCode: code,
  }));
  const epoch = await nextMessage(socket);
  assert.equal(epoch.type, 'epoch');
  const wrapKey = deriveDeviceWrapKey({
    privateKey: device.privateKey,
    peerPublicKey: pc.publicKey,
    deviceId,
  });
  const unwrappedEpochKey = unwrapEpochKey({
    deviceWrapKey: wrapKey,
    wrapped: epoch,
    deviceId,
    keyEpoch: epoch.keyEpoch,
  });
  const deviceCrypto = createChatCrypto({
    signingPrivateKey: device.privateKey,
    verifyPublicKey: pc.publicKey,
    epochKey: unwrappedEpochKey,
  });

  const before = {
    approved: registry.isApproved(deviceId),
    keyEpoch: registry.keyEpoch(),
    connected: server.connectedDevices().includes(deviceId),
  };
  const revoked = registry.revoke(deviceId);
  const afterRevoke = {
    approved: registry.isApproved(deviceId),
    keyEpoch: registry.keyEpoch(),
    connected: server.connectedDevices().includes(deviceId),
  };

  const createdAtMs = Date.now();
  const event = deviceCrypto.encryptAndSign({
    header: {
      version: 2,
      eventId: createMonotonicUlid()(),
      threadId: 'audit-thread',
      senderDeviceId: deviceId,
      deviceSequence: 1,
      keyEpoch: epoch.keyEpoch,
      routingClass: 'message',
      createdAtMs,
      expiresAtMs: createdAtMs + 60_000,
    },
    plaintext: 'message-apres-revocation',
  });
  socket.send(JSON.stringify(event));
  const ack = await nextMessage(socket);
  const encryptedReply = await nextMessage(socket);
  const decryptedReply = deviceCrypto.verifyAndDecrypt(encryptedReply);

  const result = {
    before,
    revoked,
    afterRevoke,
    receivedAfterRevocation: [
      ack.type,
      encryptedReply.type ?? 'encrypted_reply',
    ],
    responseGenerated,
    decryptedReply,
  };
  assert.deepEqual(before, { approved: true, keyEpoch: 1, connected: true });
  assert.deepEqual(revoked, { ok: true, keyEpoch: 2 });
  assert.deepEqual(afterRevoke, { approved: false, keyEpoch: 2, connected: true });
  assert.equal(ack.type, 'ack');
  assert.equal(responseGenerated, 1);
  assert.equal(decryptedReply, 'reponse-apres-revocation');
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally {
  if (socket) socket.close();
  await server.close();
}
