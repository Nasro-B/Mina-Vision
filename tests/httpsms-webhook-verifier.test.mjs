import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createHttpsmsWebhookVerifier } from '../src/messaging/httpsms/webhook-verifier.mjs';

function sign(secret, timestamp, rawBody) {
  return createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
}

describe('createHttpsmsWebhookVerifier', () => {
  it('requires a secret', () => {
    expect(() => createHttpsmsWebhookVerifier({})).toThrow(TypeError);
  });

  it('accepts a correctly signed, fresh webhook', () => {
    const verifier = createHttpsmsWebhookVerifier({ secret: 'whsec_test', now: () => 1_000_000 });
    const rawBody = '{"event":"message.received","id":"m1"}';
    const timestamp = 1_000_000;

    expect(() => verifier.verify({ rawBody, timestamp, signature: sign('whsec_test', timestamp, rawBody) }))
      .not.toThrow();
  });

  it('rejects a forged signature (wrong secret)', () => {
    const verifier = createHttpsmsWebhookVerifier({ secret: 'whsec_test', now: () => 1_000_000 });
    const rawBody = '{"event":"message.received"}';

    expect(() => verifier.verify({ rawBody, timestamp: 1_000_000, signature: sign('wrong_secret', 1_000_000, rawBody) }))
      .toThrow('httpsms_webhook_signature_invalid');
  });

  it('rejects a tampered body even with a signature that was valid for the ORIGINAL body', () => {
    const verifier = createHttpsmsWebhookVerifier({ secret: 'whsec_test', now: () => 1_000_000 });
    const originalSignature = sign('whsec_test', 1_000_000, '{"amount":1}');

    expect(() => verifier.verify({ rawBody: '{"amount":9999}', timestamp: 1_000_000, signature: originalSignature }))
      .toThrow('httpsms_webhook_signature_invalid');
  });

  it('rejects a replayed webhook whose timestamp is outside the tolerance window', () => {
    const verifier = createHttpsmsWebhookVerifier({ secret: 'whsec_test', now: () => 1_000_000, toleranceMs: 5 * 60_000 });
    const rawBody = '{"event":"x"}';
    const staleTimestamp = 1_000_000 - 10 * 60_000; // 10 minutes old, tolerance is 5

    expect(() => verifier.verify({ rawBody, timestamp: staleTimestamp, signature: sign('whsec_test', staleTimestamp, rawBody) }))
      .toThrow('httpsms_webhook_timestamp_stale');
  });

  it('rejects a body larger than the configured bound before touching the signature', () => {
    const verifier = createHttpsmsWebhookVerifier({ secret: 'whsec_test', now: () => 1_000_000, maxBodyBytes: 100 });
    const rawBody = JSON.stringify({ text: 'a'.repeat(500) });

    expect(() => verifier.verify({ rawBody, timestamp: 1_000_000, signature: sign('whsec_test', 1_000_000, rawBody) }))
      .toThrow('httpsms_webhook_body_too_large');
  });

  it('rejects the exact same signature+timestamp replayed twice (nonce reuse)', () => {
    const verifier = createHttpsmsWebhookVerifier({ secret: 'whsec_test', now: () => 1_000_000 });
    const rawBody = '{"event":"x"}';
    const signature = sign('whsec_test', 1_000_000, rawBody);

    expect(() => verifier.verify({ rawBody, timestamp: 1_000_000, signature })).not.toThrow();
    expect(() => verifier.verify({ rawBody, timestamp: 1_000_000, signature })).toThrow('httpsms_webhook_replayed');
  });

  it('parses the verified body as JSON via verifyAndParse, never on an unverified one', () => {
    const verifier = createHttpsmsWebhookVerifier({ secret: 'whsec_test', now: () => 1_000_000 });
    const rawBody = '{"event":"message.received","id":"m1"}';
    const timestamp = 1_000_000;

    expect(verifier.verifyAndParse({ rawBody, timestamp, signature: sign('whsec_test', timestamp, rawBody) }))
      .toEqual({ event: 'message.received', id: 'm1' });
  });
});
