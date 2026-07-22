import { describe, expect, it, vi } from 'vitest';
import { createMinaRuntime } from '../src/core/mina-runtime.mjs';
import { createClaimLedger } from '../src/grounding/claim-ledger.mjs';
import { createSessionManager } from '../src/sessions/session-manager.mjs';
import { createSessionStore } from '../src/sessions/session-store.mjs';
import { createBackpressureQueue } from '../src/core/backpressure.mjs';
import { createRateLimiter } from '../src/core/rate-limiter.mjs';

function createHarness({ cancellers = [], backpressureQueues = [] } = {}) {
  let id = 0;
  const store = createSessionStore();
  const sessionManager = createSessionManager({
    store, clock: () => Date.parse('2026-07-15T00:00:00.000Z'), ids: (kind) => `${kind}-${++id}`,
  });
  const claimLedger = createClaimLedger({
    clock: () => Date.parse('2026-07-15T00:00:00.000Z'), ids: () => `claim-${++id}`,
  });
  const runtime = createMinaRuntime({ sessionManager, claimLedger, cancellers, backpressureQueues });
  return { runtime, store };
}

describe('createMinaRuntime: backpressureQueues constructor guard', () => {
  it('rejects a queue without a pause method', () => {
    expect(() => createHarness({ backpressureQueues: [{ notPause: () => {} }] })).toThrow('runtime_backpressure_queues_invalid');
  });
});

describe('v2 emergency stop v2: Ctrl+Alt+Escape / "Mina, arrête" ends the work session and prevents new sends', () => {
  it('ends the active work session with reason emergency_stop', async () => {
    const cancel = vi.fn(async () => {});
    const { runtime, store } = createHarness({ cancellers: [cancel] });
    await runtime.start();

    await runtime.runWork({
      channel: 'local', identityId: 'owner', goal: 'Longue tâche',
      run: async () => {
        await runtime.emergencyStop();
        return 'should-not-matter';
      },
    });

    expect(cancel).toHaveBeenCalledTimes(1);
    const endings = store.list().filter((event) => event.type === 'work_session_end');
    expect(endings.map((event) => event.payload.reason)).toEqual(['emergency_stop']);
    expect(runtime.getSessionState().activeWorkSessions).toEqual([]);
  });

  it('pauses every wired backpressure queue — existing items survive, new sends are rejected', async () => {
    const sendQueue = createBackpressureQueue({ maxSize: 10, clock: () => 0 });
    sendQueue.enqueue('draft-message-1');
    const { runtime } = createHarness({ backpressureQueues: [sendQueue] });
    await runtime.start();

    await runtime.emergencyStop();

    expect(sendQueue.isPaused()).toBe(true);
    expect(sendQueue.size()).toBe(1); // the already-queued draft was not deleted
    expect(sendQueue.enqueue('new-message-after-stop')).toEqual({ accepted: false, reason: 'queue_paused' });
  });

  it('a subsequent runtime.start() after emergency stop still works (queue itself must be resumed explicitly, not automatically)', async () => {
    const sendQueue = createBackpressureQueue({ maxSize: 10, clock: () => 0 });
    const { runtime } = createHarness({ backpressureQueues: [sendQueue] });
    await runtime.start();
    await runtime.emergencyStop();
    expect(sendQueue.isPaused()).toBe(true);
    sendQueue.resume();
    expect(sendQueue.enqueue('after-resume')).toEqual({ accepted: true, size: 1 });
  });
});

describe('v2 emergency stop v2: rate-limited domains stay bounded independently of emergency stop', () => {
  it('a domain that already hit its rate limit stays rejected regardless of runtime state', async () => {
    const limiter = createRateLimiter({ limits: { sms: { capacity: 1, refillPerMs: 60_000 } }, clock: () => 0 });
    const { runtime } = createHarness();
    await runtime.start();

    expect(limiter.tryAcquire('sms').allowed).toBe(true);
    expect(limiter.tryAcquire('sms').allowed).toBe(false);
    await runtime.emergencyStop();
    expect(limiter.tryAcquire('sms').allowed).toBe(false);
  });
});
