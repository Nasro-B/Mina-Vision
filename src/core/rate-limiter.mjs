export function createRateLimiter({ limits, clock } = {}) {
  if (!limits || typeof limits !== 'object' || Object.keys(limits).length === 0) {
    throw new TypeError('rate_limiter_limits_required');
  }
  if (!clock || (typeof clock !== 'function' && typeof clock.now !== 'function')) {
    throw new TypeError('rate_limiter_clock_required');
  }
  const now = () => Number(typeof clock === 'function' ? clock() : clock.now());
  const buckets = new Map();
  for (const [domain, config] of Object.entries(limits)) {
    buckets.set(domain, { capacity: config.capacity, refillPerMs: config.refillPerMs, tokens: config.capacity, lastRefillAt: now() });
  }

  function refill(bucket) {
    const elapsed = now() - bucket.lastRefillAt;
    if (elapsed <= 0) return;
    const refillRate = bucket.capacity / bucket.refillPerMs;
    bucket.tokens = Math.min(bucket.capacity, bucket.tokens + elapsed * refillRate);
    bucket.lastRefillAt = now();
  }

  return Object.freeze({
    // Clean, deterministic rejection once capacity is exhausted — never queues unbounded traffic,
    // never throws for a normal over-limit request (only for a domain that was never configured).
    tryAcquire(domain) {
      const bucket = buckets.get(domain);
      if (!bucket) throw new Error('rate_limiter_domain_not_configured');
      refill(bucket);
      if (bucket.tokens >= 1) {
        bucket.tokens -= 1;
        return Object.freeze({ allowed: true, remaining: Math.floor(bucket.tokens) });
      }
      const missing = 1 - bucket.tokens;
      const retryAfterMs = Math.ceil(missing / (bucket.capacity / bucket.refillPerMs));
      return Object.freeze({ allowed: false, remaining: 0, retryAfterMs });
    },
  });
}
