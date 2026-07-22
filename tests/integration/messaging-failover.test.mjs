import { describe, expect, it, vi } from 'vitest';
import { createPhysicalDeviceRegistry } from '../../src/devices/physical-device-registry.mjs';
import { createAndroidTransportClient } from '../../src/devices/android-transport-client.mjs';
import { createFirebaseTransport } from '../../src/devices/firebase-transport.mjs';

const NOW = Date.parse('2026-07-16T10:00:00.000Z');

function encryptedEnvelope(id, overrides = {}) {
  return {
    version: 1, id, correlationId: 'corr-1', channel: 'telegram', kind: 'message.text',
    createdAt: new Date(NOW).toISOString(), expiresAt: new Date(NOW + 60_000).toISOString(),
    sender: 'owner', counter: 1, algorithms: 'aes-256-gcm',
    payloadCiphertext: 'ZmFrZS1jaXBoZXJ0ZXh0', nonce: 'ZmFrZS1ub25jZQ', authTag: 'ZmFrZS10YWc', signature: 'ZmFrZS1zaWc',
    ...overrides,
  };
}

function fakeFirebaseBackend() {
  const rows = new Map();
  return { put: vi.fn(async (id, record) => rows.set(id, record)), get: vi.fn(async (id) => rows.get(id) ?? null), remove: vi.fn(async (id) => rows.delete(id)) };
}

describe('v2 integration: USB -> LAN -> Firebase transport failover for one physical device', () => {
  it('falls back from USB to LAN to Firebase as each transport fails, and Firebase only ever receives an encrypted envelope', async () => {
    const registry = createPhysicalDeviceRegistry();
    registry.observeEndpoint({ deviceId: 'huawei-1', verified: true, endpoint: { endpointId: 'usb-1', type: 'usb', serial: 'HUAWEITESTSERIAL' } });
    registry.observeEndpoint({ deviceId: 'huawei-1', verified: true, endpoint: { endpointId: 'lan-1', type: 'lan', serial: 'HUAWEITESTSERIAL' } });
    registry.observeEndpoint({ deviceId: 'huawei-1', verified: true, endpoint: { endpointId: 'firebase-1', type: 'firebase', serial: 'HUAWEITESTSERIAL' } });

    const firebaseBackend = fakeFirebaseBackend();
    let firebaseDirectAvailable = false;
    const firebaseTransport = createFirebaseTransport({ backend: firebaseBackend, clock: () => NOW, directAvailable: () => firebaseDirectAvailable });

    const client = createAndroidTransportClient({ verifyPeer: async () => true });
    await client.connect({ endpoint: { endpointId: 'usb-1', type: 'usb', send: vi.fn(async () => { throw new Error('usb_cable_unplugged'); }) }, proof: { deviceId: 'huawei-1' } });
    await client.connect({ endpoint: { endpointId: 'lan-1', type: 'lan', send: vi.fn(async () => { throw new Error('lan_unreachable'); }) }, proof: { deviceId: 'huawei-1' } });
    await client.connect({
      endpoint: {
        endpointId: 'firebase-1', type: 'firebase',
        send: vi.fn(async (envelope) => {
          const result = await firebaseTransport.enqueue(envelope);
          return { accepted: true, envelopeId: result.envelopeId };
        }),
      },
      proof: { deviceId: 'huawei-1' },
    });

    const envelope = encryptedEnvelope('env-1');
    const result = await client.send({ queue: 'message', envelope });
    expect(result.transport).toBe('firebase');
    expect(firebaseBackend.put).toHaveBeenCalledTimes(1);

    // Firebase never receives plaintext — only the pre-encrypted envelope fields ever reach the backend.
    const [, storedRecord] = firebaseBackend.put.mock.calls[0];
    expect(storedRecord).not.toHaveProperty('body');
    expect(storedRecord).not.toHaveProperty('plaintext');
    expect(storedRecord.payloadCiphertext).toBe(envelope.payloadCiphertext);
  });

  it('a lost ack (duplicate send of the same envelope id) is deduplicated, never delivered twice', async () => {
    const client = createAndroidTransportClient({ verifyPeer: async () => true });
    const send = vi.fn(async (env) => ({ accepted: true, envelopeId: env.id }));
    await client.connect({ endpoint: { endpointId: 'usb-1', type: 'usb', send }, proof: { deviceId: 'huawei-1' } });

    const envelope = encryptedEnvelope('env-2');
    const first = await client.send({ queue: 'message', envelope });
    expect(first.accepted).toBe(true);
    const second = await client.send({ queue: 'message', envelope });
    expect(second).toEqual({ duplicate: true, envelopeId: 'env-2' });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('Firebase refuses to enqueue while a direct transport is available (fallback-only, never a shortcut)', async () => {
    const firebaseBackend = fakeFirebaseBackend();
    const firebaseTransport = createFirebaseTransport({ backend: firebaseBackend, clock: () => NOW, directAvailable: () => true });
    await expect(firebaseTransport.enqueue(encryptedEnvelope('env-3'))).rejects.toThrow('firebase_direct_transport_available');
  });

  it('Firebase rejects a forbidden payload kind (camera/face/email body/secret) even if otherwise well-formed', async () => {
    const firebaseBackend = fakeFirebaseBackend();
    const firebaseTransport = createFirebaseTransport({ backend: firebaseBackend, clock: () => NOW, directAvailable: () => false });
    await expect(firebaseTransport.enqueue(encryptedEnvelope('env-4', { kind: 'camera.frame' }))).rejects.toThrow('firebase_payload_forbidden');
  });
});
