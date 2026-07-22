export function createBackpressureQueue({ maxSize, clock } = {}) {
  if (!Number.isSafeInteger(maxSize) || maxSize < 1) throw new TypeError('backpressure_max_size_required');
  if (!clock || (typeof clock !== 'function' && typeof clock.now !== 'function')) {
    throw new TypeError('backpressure_clock_required');
  }
  const now = () => Number(typeof clock === 'function' ? clock() : clock.now());
  const items = [];
  let paused = false;
  let rejected = 0;

  return Object.freeze({
    // Bounded by maxSize regardless of load — a rejection is a normal, clean outcome, never an
    // unbounded array growth and never a thrown error for the caller to catch.
    enqueue(item) {
      if (paused) { rejected += 1; return Object.freeze({ accepted: false, reason: 'queue_paused' }); }
      if (items.length >= maxSize) { rejected += 1; return Object.freeze({ accepted: false, reason: 'queue_full' }); }
      items.push({ item, enqueuedAt: new Date(now()).toISOString() });
      return Object.freeze({ accepted: true, size: items.length });
    },

    dequeue() {
      if (paused || items.length === 0) return null;
      return items.shift().item;
    },

    size: () => items.length,
    rejectedCount: () => rejected,
    isPaused: () => paused,

    // Emergency stop marks the queue paused rather than deleting it — items already accepted stay
    // intact; only new enqueues and further dequeues are blocked until resume() is called.
    pause() { paused = true; },
    resume() { paused = false; },
  });
}
