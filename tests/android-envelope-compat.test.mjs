import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { verifyAndDecryptEnvelope } from '../src/devices/secure-envelope.mjs';

const fixtureUrl = new URL('./fixtures/protocol/mina-envelope-v1.json', import.meta.url);

describe('PC/Android secure envelope compatibility', () => {
  it('verifies the ES256 signature and decrypts the AES-256-GCM fixture', async () => {
    const fixture = JSON.parse(await readFile(fixtureUrl, 'utf8'));
    const result = verifyAndDecryptEnvelope({
      envelope: fixture.envelope,
      aesKey: Buffer.from(fixture.testOnly.aesKeyBase64, 'base64'),
      publicKey: fixture.testOnly.publicKeySpkiBase64,
      now: Date.parse('2026-07-15T08:00:00.000Z'),
      lastCounter: 40,
    });

    expect(result.counter).toBe(41);
    expect(JSON.parse(result.plaintext.toString('utf8'))).toEqual({ text: 'Bonjour Mina Vision' });
  });

  it('rejects expiry, replay and a changed signature before decryption', async () => {
    const fixture = JSON.parse(await readFile(fixtureUrl, 'utf8'));
    const request = {
      envelope: fixture.envelope,
      aesKey: Buffer.from(fixture.testOnly.aesKeyBase64, 'base64'),
      publicKey: fixture.testOnly.publicKeySpkiBase64,
      now: Date.parse('2026-07-15T08:00:00.000Z'),
      lastCounter: 40,
    };
    expect(() => verifyAndDecryptEnvelope({ ...request, lastCounter: 41 })).toThrow('envelope_replay_rejected');
    expect(() => verifyAndDecryptEnvelope({ ...request, now: Date.parse('2026-07-16T00:00:00.000Z') }))
      .toThrow('envelope_expired');
    const changed = { ...fixture.envelope, signature: fixture.envelope.signature.replace(/^./u, 'A') };
    expect(() => verifyAndDecryptEnvelope({ ...request, envelope: changed })).toThrow('envelope_signature_invalid');
  });
});
