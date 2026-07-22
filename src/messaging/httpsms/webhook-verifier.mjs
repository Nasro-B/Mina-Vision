import { createHmac, timingSafeEqual } from 'node:crypto';

// Verifies inbound httpSMS-style webhooks: HMAC-SHA256 over `${timestamp}.${rawBody}` with a
// shared secret, timing-safe comparison, a bounded body size, a replay tolerance window, and a
// short-lived seen-signature cache against exact replays. Clean-room design (see contracts.mjs).
export function createHttpsmsWebhookVerifier({
  secret,
  now = () => Date.now(),
  toleranceMs = 5 * 60_000,
  maxBodyBytes = 256 * 1_024,
  maxSeenEntries = 1_000,
} = {}) {
  if (typeof secret !== 'string' || secret.length < 8) throw new TypeError('httpsms_webhook_secret_invalid');
  const seen = new Set();

  function rememberSeen(signature) {
    seen.add(signature);
    if (seen.size > maxSeenEntries) seen.delete(seen.values().next().value);
  }

  function verify({ rawBody, timestamp, signature } = {}) {
    if (typeof rawBody !== 'string' || Buffer.byteLength(rawBody, 'utf8') > maxBodyBytes) {
      throw new Error('httpsms_webhook_body_too_large');
    }
    if (typeof signature !== 'string' || !signature) throw new Error('httpsms_webhook_signature_invalid');
    const expected = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
    const expectedBuffer = Buffer.from(expected, 'hex');
    const providedBuffer = Buffer.from(signature, 'hex');
    if (expectedBuffer.length !== providedBuffer.length || !timingSafeEqual(expectedBuffer, providedBuffer)) {
      throw new Error('httpsms_webhook_signature_invalid');
    }
    if (!Number.isFinite(timestamp) || Math.abs(now() - timestamp) > toleranceMs) {
      throw new Error('httpsms_webhook_timestamp_stale');
    }
    if (seen.has(signature)) throw new Error('httpsms_webhook_replayed');
    rememberSeen(signature);
  }

  return Object.freeze({
    verify,
    verifyAndParse(input) {
      verify(input);
      try {
        return JSON.parse(input.rawBody);
      } catch {
        throw new Error('httpsms_webhook_body_invalid_json');
      }
    },
  });
}
