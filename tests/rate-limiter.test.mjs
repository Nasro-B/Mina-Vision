import { describe, expect, it } from 'vitest';
import { createRateLimiter } from '../src/core/rate-limiter.mjs';

describe('createRateLimiter: constructor guards', () => {
  it('requires limits', () => {
    expect(() => createRateLimiter({ clock: () => 0 })).toThrow('rate_limiter_limits_required');
  });

  it('requires a clock', () => {
    expect(() => createRateLimiter({ limits: { home: { capacity: 5, refillPerMs: 1000 } } })).toThrow('rate_limiter_clock_required');
  });

  it('rejects a clock that is neither a function nor a {now()} object', () => {
    expect(() => createRateLimiter({ limits: { home: { capacity: 5, refillPerMs: 1000 } }, clock: {} })).toThrow('rate_limiter_clock_required');
  });

  it('rejects an empty limits object', () => {
    expect(() => createRateLimiter({ limits: {}, clock: () => 0 })).toThrow('rate_limiter_limits_required');
  });
});

describe('createRateLimiter.tryAcquire: token bucket per domain', () => {
  it('allows up to capacity, then rejects cleanly (no exception, no unbounded growth)', () => {
    let clockValue = 0;
    const limiter = createRateLimiter({ limits: { home: { capacity: 3, refillPerMs: 1000 } }, clock: () => clockValue });
    expect(limiter.tryAcquire('home')).toEqual({ allowed: true, remaining: 2 });
    expect(limiter.tryAcquire('home')).toEqual({ allowed: true, remaining: 1 });
    expect(limiter.tryAcquire('home')).toEqual({ allowed: true, remaining: 0 });
    const rejected = limiter.tryAcquire('home');
    expect(rejected.allowed).toBe(false);
    expect(rejected.retryAfterMs).toBeGreaterThan(0);
  });

  it('refills over time at the configured rate', () => {
    let clockValue = 0;
    const limiter = createRateLimiter({ limits: { home: { capacity: 1, refillPerMs: 1000 } }, clock: () => clockValue });
    expect(limiter.tryAcquire('home').allowed).toBe(true);
    expect(limiter.tryAcquire('home').allowed).toBe(false);
    clockValue += 1000;
    expect(limiter.tryAcquire('home').allowed).toBe(true);
  });

  it('tracks each domain independently', () => {
    const limiter = createRateLimiter({ limits: { home: { capacity: 1, refillPerMs: 1000 }, mail: { capacity: 1, refillPerMs: 1000 } }, clock: () => 0 });
    expect(limiter.tryAcquire('home').allowed).toBe(true);
    expect(limiter.tryAcquire('mail').allowed).toBe(true);
    expect(limiter.tryAcquire('home').allowed).toBe(false);
  });

  it('rejects an unconfigured domain rather than allowing unbounded traffic', () => {
    const limiter = createRateLimiter({ limits: { home: { capacity: 1, refillPerMs: 1000 } }, clock: () => 0 });
    expect(() => limiter.tryAcquire('unknown-domain')).toThrow('rate_limiter_domain_not_configured');
  });
});
