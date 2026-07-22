import { describe, expect, it } from 'vitest';
import { classifyMessagingError, nextRetryDelayMs, shouldDeadLetter } from '../src/messaging/message-retry-policy.mjs';

describe('classifyMessagingError', () => {
  it.each(['429 Too Many Requests', 'rate limit exceeded', 'RESOURCE_EXHAUSTED'])(
    'classifies "%s" as rate_limited', (message) => {
      expect(classifyMessagingError(new Error(message)).kind).toBe('rate_limited');
    },
  );

  it('extracts retryAfterMs from a structured retryAfter hint', () => {
    const result = classifyMessagingError(Object.assign(new Error('429'), { retryAfterMs: 12_000 }));
    expect(result).toMatchObject({ kind: 'rate_limited', retryAfterMs: 12_000 });
  });

  it.each(['ETIMEDOUT', 'socket hang up', 'network error', 'fetch failed', '503 Service Unavailable'])(
    'classifies "%s" as transient', (message) => {
      expect(classifyMessagingError(new Error(message)).kind).toBe('transient');
    },
  );

  it.each(['chat not found', 'bot was blocked by the user', 'invalid recipient', 'user is deactivated'])(
    'classifies "%s" as permanent_target', (message) => {
      expect(classifyMessagingError(new Error(message)).kind).toBe('permanent_target');
    },
  );

  it('classifies an explicit owner refusal', () => {
    expect(classifyMessagingError(new Error('confirmation_refused')).kind).toBe('owner_refused');
  });

  it('classifies device_absent for a missing/disconnected gateway', () => {
    expect(classifyMessagingError(new Error('phone_identity_unavailable')).kind).toBe('device_absent');
    expect(classifyMessagingError(new Error('device offline')).kind).toBe('device_absent');
  });

  it('falls back to transient for an unrecognized error rather than dead-lettering blindly', () => {
    expect(classifyMessagingError(new Error('something odd happened')).kind).toBe('transient');
  });
});

describe('nextRetryDelayMs', () => {
  it('grows exponentially with attempt for a plain transient failure', () => {
    expect(nextRetryDelayMs({ attempt: 1, kind: 'transient' })).toBe(1_000);
    expect(nextRetryDelayMs({ attempt: 2, kind: 'transient' })).toBe(2_000);
    expect(nextRetryDelayMs({ attempt: 3, kind: 'transient' })).toBe(4_000);
  });

  it('honors an explicit retryAfterMs for rate_limited, bounded to a sane ceiling', () => {
    expect(nextRetryDelayMs({ attempt: 1, kind: 'rate_limited', retryAfterMs: 5_000 })).toBe(5_000);
    expect(nextRetryDelayMs({ attempt: 1, kind: 'rate_limited', retryAfterMs: 999_999_999 })).toBe(3_600_000);
  });

  it('caps exponential backoff at one hour', () => {
    expect(nextRetryDelayMs({ attempt: 20, kind: 'transient' })).toBe(3_600_000);
  });
});

describe('shouldDeadLetter', () => {
  it('stays false under the attempt budget and true once exhausted', () => {
    expect(shouldDeadLetter({ attempt: 1 })).toBe(false);
    expect(shouldDeadLetter({ attempt: 4 })).toBe(false);
    expect(shouldDeadLetter({ attempt: 5 })).toBe(true);
    expect(shouldDeadLetter({ attempt: 9 })).toBe(true);
  });

  it('dead-letters immediately (attempt 1) for permanent_target and owner_refused — retrying is pointless', () => {
    expect(shouldDeadLetter({ attempt: 1, kind: 'permanent_target' })).toBe(true);
    expect(shouldDeadLetter({ attempt: 1, kind: 'owner_refused' })).toBe(true);
  });

  it('respects a custom maxAttempts', () => {
    expect(shouldDeadLetter({ attempt: 2, kind: 'transient', maxAttempts: 2 })).toBe(true);
    expect(shouldDeadLetter({ attempt: 1, kind: 'transient', maxAttempts: 2 })).toBe(false);
  });
});
