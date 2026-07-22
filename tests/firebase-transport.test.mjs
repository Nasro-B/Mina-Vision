import { describe, expect, it, vi } from 'vitest';
import { createFirebaseTransport } from '../src/devices/firebase-transport.mjs';

const envelope = (overrides = {}) => ({
  version: 1, id: 'env-1', kind: 'sms.message', createdAt: '2026-07-15T09:00:00.000Z',
  expiresAt: '2026-07-15T10:00:00.000Z', payloadCiphertext: 'ciphertext', nonce: 'nonce',
  authTag: 'tag', signature: 'signature', ...overrides,
});

describe('ciphertext-only Firebase fallback transport', () => {
  it('stores only bounded encrypted envelopes and deduplicates recovery', async () => {
    const records = new Map();
    const backend = {
      put: vi.fn(async (id, value) => records.set(id, structuredClone(value))),
      get: vi.fn(async (id) => records.get(id)),
      remove: vi.fn(async (id) => records.delete(id)),
    };
    const transport = createFirebaseTransport({ backend, clock: () => Date.parse('2026-07-15T09:05:00Z') });
    await expect(transport.enqueue(envelope())).resolves.toMatchObject({ queued: true, envelopeId: 'env-1' });
    expect(records.get('env-1')).not.toHaveProperty('plaintext');
    await expect(transport.receive('env-1')).resolves.toMatchObject({ envelope: { payloadCiphertext: 'ciphertext' }, capabilities: [] });
    await expect(transport.receive('env-1')).resolves.toEqual({ duplicate: true, envelopeId: 'env-1' });
  });

  it('rejects expired/long TTL, forbidden payload categories and yields to direct transport', async () => {
    const backend = { put: vi.fn(), get: vi.fn(), remove: vi.fn() };
    const direct = createFirebaseTransport({ backend, directAvailable: () => true, clock: () => Date.parse('2026-07-15T09:05:00Z') });
    await expect(direct.enqueue(envelope())).rejects.toThrow('firebase_direct_transport_available');
    const fallback = createFirebaseTransport({ backend, clock: () => Date.parse('2026-07-15T09:05:00Z') });
    await expect(fallback.enqueue(envelope({ expiresAt: '2026-07-17T09:00:00Z' }))).rejects.toThrow('firebase_ttl_exceeded');
    for (const kind of ['camera.frame', 'face.embedding', 'email.body', 'secret.value']) {
      await expect(fallback.enqueue(envelope({ id: `env-${kind}`, kind }))).rejects.toThrow('firebase_payload_forbidden');
    }
  });
});
