import { CLAIM_STATUS } from '../contracts/claims.mjs';

export function createMinaRuntime({
  sessionManager, claimLedger, evidenceProvider = async () => [], cancellers = [], domainRegistry = null,
  backpressureQueues = [],
}) {
  if (!sessionManager || !claimLedger) throw new TypeError('runtime_dependencies_required');
  if (!Array.isArray(cancellers) || cancellers.some((cancel) => typeof cancel !== 'function')) {
    throw new TypeError('runtime_cancellers_invalid');
  }
  if (!Array.isArray(backpressureQueues) || backpressureQueues.some((queue) => typeof queue?.pause !== 'function')) {
    throw new TypeError('runtime_backpressure_queues_invalid');
  }
  let runtimeStatus = 'created';
  let emergencyGeneration = 0;
  const activeWork = new Map();

  function withResultClaim(value, workSessionId) {
    if (!value || typeof value !== 'object'
      || value.status !== 'completed'
      || typeof value.result !== 'string'
      || value.result.trim().length < 1
      || !Number.isInteger(value.actionCount)
      || Object.hasOwn(value, 'resultClaimId')) {
      return value;
    }
    const claim = claimLedger.add({
      sessionId: workSessionId,
      text: value.result,
      kind: 'mission_result',
      sourceRefs: [],
      status: 'verified',
      sensitivity: 'internal',
    });
    return Object.freeze({ ...value, resultClaimId: claim.claimId });
  }

  async function start() {
    if (runtimeStatus !== 'created') throw new Error('runtime_already_started');
    runtimeStatus = 'starting';
    if (domainRegistry) await domainRegistry.startAll();
    await sessionManager.recover();
    await sessionManager.startRuntime();
    await sessionManager.ready();
    runtimeStatus = 'ready';
  }

  async function runWork({ channel, identityId, goal, memoryRequired = false, run }) {
    if (runtimeStatus !== 'ready') throw new Error('runtime_not_ready');
    if (typeof run !== 'function') throw new TypeError('work_runner_required');
    const workGeneration = emergencyGeneration;
    const work = await sessionManager.startWork({ channel, identityId, goal });
    const entry = { ...work, canceled: false };
    activeWork.set(work.workSessionId, entry);
    try {
      if (workGeneration !== emergencyGeneration) {
        entry.canceled = true;
        await sessionManager.endWork({ workSessionId: work.workSessionId, reason: 'emergency_stop' });
        return undefined;
      }
      await sessionManager.beforeTurn({ workSessionId: work.workSessionId });
      const evidence = await evidenceProvider({ channel, identityId, goal, memoryRequired });
      if (!Array.isArray(evidence)) throw new TypeError('runtime_evidence_must_be_array');
      const rawValue = await run({ evidence: Object.freeze([...evidence]), workSessionId: work.workSessionId });
      const value = withResultClaim(rawValue, work.workSessionId);
      if (entry.canceled) return value;
      const after = await sessionManager.afterTurn({ workSessionId: work.workSessionId });
      if (!work.microSession && after.status === 'active') {
        await sessionManager.endWork({ workSessionId: work.workSessionId, reason: 'completed' });
      }
      return value;
    } catch (error) {
      if (!entry.canceled) {
        await sessionManager.endWork({ workSessionId: work.workSessionId, reason: 'error' });
      }
      throw error;
    } finally {
      activeWork.delete(work.workSessionId);
    }
  }

  async function emergencyStop() {
    emergencyGeneration += 1;
    await Promise.allSettled(cancellers.map((cancel) => cancel()));
    // Marks queued/pending sends paused rather than deleting them — "empêchent nouveaux sends":
    // pause() rejects any further enqueue attempt while leaving already-accepted items intact.
    for (const queue of backpressureQueues) queue.pause();
    for (const entry of activeWork.values()) {
      if (entry.canceled) continue;
      entry.canceled = true;
      await sessionManager.endWork({ workSessionId: entry.workSessionId, reason: 'emergency_stop' });
    }
    return Object.freeze({ stopped: true });
  }

  async function shutdown({ timeoutMs = 2_000 } = {}) {
    if (runtimeStatus === 'ended') return Object.freeze({ status: 'ended' });
    runtimeStatus = 'ending';
    const ending = (async () => {
      await emergencyStop();
      if (domainRegistry) await domainRegistry.stopAll();
      await sessionManager.endRuntime({ reason: 'quit' });
      runtimeStatus = 'ended';
      return Object.freeze({ status: 'ended' });
    })();
    const timeout = new Promise((resolve) => {
      setTimeout(() => resolve(Object.freeze({ status: 'timeout' })), timeoutMs).unref?.();
    });
    return Promise.race([ending, timeout]);
  }

  function getSessionState() {
    return Object.freeze({
      runtimeStatus,
      activeWorkSessions: Object.freeze([...activeWork.values()].map((work) => Object.freeze({
        workSessionId: work.workSessionId,
        channel: work.channel,
        goal: work.goal,
      }))),
    });
  }

  function getClaims() {
    return claimLedger.list();
  }

  function getGroundingStatus() {
    const counts = Object.fromEntries(CLAIM_STATUS.map((status) => [status, 0]));
    const claims = claimLedger.list();
    for (const claim of claims) counts[claim.status] += 1;
    return Object.freeze({ total: claims.length, ...counts });
  }

  return Object.freeze({
    start,
    runWork,
    emergencyStop,
    shutdown,
    getSessionState,
    getClaims,
    getGroundingStatus,
  });
}
