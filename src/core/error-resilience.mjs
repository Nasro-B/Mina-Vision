// Resilience for tool/model calls: transient faults (network, timeouts, overloaded providers,
// flaky screenshots, device hiccups) are retried with bounded backoff; everything else surfaces
// immediately. HARD RULE — a safety refusal (blocked action, refused confirmation, policy denial)
// is NEVER retried: resilience applies to faults, never to refusals.

const SAFETY_PATTERN = /confirmation[_ ]refus|refus[eé]e?\b|safety[_ ]?block|blocked|forbidden|unauthorized|permission denied|policy/iu;

const TRANSIENT_PATTERN = new RegExp([
  'timed? ?out', 'timeout', 'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ECONNABORTED', 'EAI_AGAIN',
  'ENETUNREACH', 'EHOSTUNREACH', 'EPIPE', 'socket hang up', 'network', 'fetch failed',
  // « Connection error. » : message NU du SDK @google/genai sur une coupure réseau — il ne
  // matchait AUCUN motif ci-dessous et tombait en « permanent » : zéro retry, mission morte
  // instantanément (journal 2026-07-22 10:03/10:15/10:16).
  'connection',
  '\\b429\\b', '\\b500\\b', '\\b502\\b', '\\b503\\b', '\\b504\\b',
  'quota', 'rate ?limit', 'RESOURCE_EXHAUSTED', 'unavailable', 'overloaded', 'internal error',
  'screenshot', 'device offline', 'has been closed', 'disconnect',
].join('|'), 'iu');

export function classifyFailure(error) {
  const message = String(error?.message ?? error ?? '');
  if (SAFETY_PATTERN.test(message)) return 'safety';
  if (TRANSIENT_PATTERN.test(message)) return 'transient';
  return 'permanent';
}

export async function withRetry(fn, {
  attempts = 3,
  baseDelayMs = 400,
  classify = classifyFailure,
  onRetry = () => {},
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  let attempt = 0;
  for (;;) {
    attempt += 1;
    try {
      return await fn();
    } catch (error) {
      if (classify(error) !== 'transient' || attempt >= attempts) throw error;
      const delayMs = baseDelayMs * 2 ** (attempt - 1);
      onRetry({ attempt, delayMs, error });
      await sleep(delayMs);
    }
  }
}
