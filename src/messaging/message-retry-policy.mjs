// Classifies a messaging (Telegram/SMS) delivery failure and decides retry timing. Pure and
// injectable — no I/O, no clock reads unless explicitly asked (nextRetryDelayMs is deterministic
// given attempt/kind, the caller adds Date.now()).

const RATE_LIMITED = /\b429\b|rate ?limit|RESOURCE_EXHAUSTED/iu;
const TRANSIENT = /timed? ?out|ETIMEDOUT|ECONNRESET|ECONNREFUSED|socket hang up|network|fetch failed|\b50[0-4]\b|unavailable/iu;
const PERMANENT_TARGET = /chat not found|blocked by the user|invalid recipient|user is deactivated|target.*invalid|invalid.*target/iu;
const OWNER_REFUSED = /confirmation_refused|owner_refused/iu;
const DEVICE_ABSENT = /phone_identity_unavailable|device offline|device_absent|no_authorized/iu;

const NO_RETRY_KINDS = new Set(['permanent_target', 'owner_refused']);
const MAX_BACKOFF_MS = 3_600_000;
const BASE_DELAY_MS = 1_000;

export function classifyMessagingError(error) {
  const message = String(error?.message ?? error ?? '');
  const retryAfterMs = Number.isFinite(error?.retryAfterMs) ? error.retryAfterMs : undefined;
  if (RATE_LIMITED.test(message)) return Object.freeze({ kind: 'rate_limited', ...(retryAfterMs !== undefined ? { retryAfterMs } : {}) });
  if (OWNER_REFUSED.test(message)) return Object.freeze({ kind: 'owner_refused' });
  if (PERMANENT_TARGET.test(message)) return Object.freeze({ kind: 'permanent_target' });
  if (DEVICE_ABSENT.test(message)) return Object.freeze({ kind: 'device_absent' });
  if (TRANSIENT.test(message)) return Object.freeze({ kind: 'transient' });
  // Unrecognized errors default to transient: dead-lettering on the first unfamiliar message
  // would silently drop real user messages instead of giving them a couple of retries.
  return Object.freeze({ kind: 'transient' });
}

export function nextRetryDelayMs({ attempt, kind, retryAfterMs }) {
  if (kind === 'rate_limited' && Number.isFinite(retryAfterMs)) {
    return Math.min(Math.max(retryAfterMs, 0), MAX_BACKOFF_MS);
  }
  const exponential = BASE_DELAY_MS * 2 ** (Math.max(attempt, 1) - 1);
  return Math.min(exponential, MAX_BACKOFF_MS);
}

export function shouldDeadLetter({ attempt, kind, maxAttempts = 5 }) {
  if (NO_RETRY_KINDS.has(kind)) return true;
  return attempt >= maxAttempts;
}
