import { randomUUID } from 'node:crypto';
import { CHANNELS } from '../contracts/envelope.mjs';
import { parseSessionEvent } from '../contracts/events.mjs';

const TELEGRAM_IDLE_TIMEOUT_MS = 30 * 60_000;

function snapshot(session) {
  return Object.freeze({ ...session });
}

export function createSessionManager({
  store,
  clock = Date.now,
  ids = () => randomUUID(),
  hooks = {},
  checkpointEveryMs = 60_000,
}) {
  if (!store?.append || !store?.list) throw new TypeError('session_store_required');
  if (!Number.isFinite(checkpointEveryMs) || checkpointEveryMs <= 0) {
    throw new TypeError('invalid_checkpoint_interval');
  }

  const now = () => Number(typeof clock === 'function' ? clock() : clock.now());
  const nextId = (kind) => String(typeof ids === 'function' ? ids(kind) : ids.next(kind));
  let runtime = null;
  const workSessions = new Map();
  const workKeys = new Map();

  async function publish({
    type,
    runtimeSessionId,
    workSessionId = null,
    channel = 'local',
    payload = {},
  }) {
    const event = parseSessionEvent({
      eventId: nextId('event'),
      runtimeSessionId,
      workSessionId,
      type,
      occurredAt: new Date(now()).toISOString(),
      channel,
      payload,
    });
    store.append(event);
    await hooks[type]?.(event);
    return event;
  }

  function requireRuntime() {
    if (!runtime || runtime.status !== 'active') throw new Error('runtime_not_active');
    return runtime;
  }

  function requireWork(workSessionId) {
    const active = [...workSessions.values()].filter((work) => work.status === 'active');
    const resolvedId = workSessionId ?? (active.length === 1 ? active[0].workSessionId : null);
    const work = resolvedId ? workSessions.get(resolvedId) : null;
    if (!work || work.status !== 'active') throw new Error('work_session_not_active');
    return work;
  }

  async function startRuntime() {
    if (runtime && ['active', 'ending'].includes(runtime.status)) {
      throw new Error('runtime_already_active');
    }
    const startedAt = now();
    runtime = {
      runtimeSessionId: nextId('runtime'),
      status: 'active',
      startedAt,
      readyAt: null,
      endedAt: null,
    };
    await publish({
      type: 'runtime_start',
      runtimeSessionId: runtime.runtimeSessionId,
      payload: { status: 'active' },
    });
    return snapshot(runtime);
  }

  async function ready() {
    const activeRuntime = requireRuntime();
    activeRuntime.readyAt = now();
    await publish({
      type: 'runtime_ready',
      runtimeSessionId: activeRuntime.runtimeSessionId,
      payload: { status: 'active' },
    });
    return snapshot(activeRuntime);
  }

  async function startWork({ channel, identityId, goal }) {
    const activeRuntime = requireRuntime();
    if (!CHANNELS.includes(channel)) throw new TypeError('invalid_channel');
    if (typeof identityId !== 'string' || !identityId.trim()) throw new TypeError('identity_required');
    if (typeof goal !== 'string' || !goal.trim()) throw new TypeError('goal_required');

    const key = `${channel}:${identityId}`;
    const existingId = workKeys.get(key);
    if (existingId && workSessions.get(existingId)?.status === 'active') {
      throw new Error('work_session_already_active');
    }

    const startedAt = now();
    const work = {
      workSessionId: nextId('work'),
      runtimeSessionId: activeRuntime.runtimeSessionId,
      channel,
      identityId,
      goal,
      status: 'active',
      microSession: channel === 'sms',
      toolsAllowed: channel !== 'sms',
      startedAt,
      lastActivityAt: startedAt,
      lastCheckpointAt: startedAt,
      endedAt: null,
    };
    workSessions.set(work.workSessionId, work);
    workKeys.set(key, work.workSessionId);
    await publish({
      type: 'work_session_start',
      runtimeSessionId: work.runtimeSessionId,
      workSessionId: work.workSessionId,
      channel: work.channel,
      payload: {
        identityId: work.identityId,
        goal: work.goal,
        status: 'active',
        microSession: work.microSession,
        toolsAllowed: work.toolsAllowed,
      },
    });
    return snapshot(work);
  }

  async function expireTelegramIfNeeded(work) {
    if (work.channel !== 'telegram' || now() - work.lastActivityAt <= TELEGRAM_IDLE_TIMEOUT_MS) return;
    await endWork({ workSessionId: work.workSessionId, reason: 'idle_timeout' });
    throw new Error('work_session_expired');
  }

  async function beforeTurn({ workSessionId } = {}) {
    const work = requireWork(workSessionId);
    await expireTelegramIfNeeded(work);
    work.lastActivityAt = now();
    await publish({
      type: 'before_turn',
      runtimeSessionId: work.runtimeSessionId,
      workSessionId: work.workSessionId,
      channel: work.channel,
      payload: { status: 'active' },
    });
    return snapshot(work);
  }

  async function afterTurn({ workSessionId } = {}) {
    const work = requireWork(workSessionId);
    work.lastActivityAt = now();
    await publish({
      type: 'after_turn',
      runtimeSessionId: work.runtimeSessionId,
      workSessionId: work.workSessionId,
      channel: work.channel,
      payload: { status: 'active' },
    });
    if (now() - work.lastCheckpointAt >= checkpointEveryMs) {
      await checkpoint({ workSessionId: work.workSessionId });
    }
    if (work.microSession) {
      return endWork({ workSessionId: work.workSessionId, reason: 'sms_micro_session_complete' });
    }
    return snapshot(work);
  }

  async function beforeTool({ workSessionId, tool }) {
    const work = requireWork(workSessionId);
    await publish({
      type: 'before_tool',
      runtimeSessionId: work.runtimeSessionId,
      workSessionId: work.workSessionId,
      channel: work.channel,
      payload: { tool, status: 'active' },
    });
    return snapshot(work);
  }

  async function afterTool({ workSessionId, tool, result = null }) {
    const work = requireWork(workSessionId);
    await publish({
      type: 'after_tool',
      runtimeSessionId: work.runtimeSessionId,
      workSessionId: work.workSessionId,
      channel: work.channel,
      payload: { tool, result, status: 'active' },
    });
    return snapshot(work);
  }

  async function checkpoint({ workSessionId } = {}) {
    const work = requireWork(workSessionId);
    work.lastCheckpointAt = now();
    await publish({
      type: 'checkpoint',
      runtimeSessionId: work.runtimeSessionId,
      workSessionId: work.workSessionId,
      channel: work.channel,
      payload: { status: 'active' },
    });
    return snapshot(work);
  }

  async function endWork({ workSessionId, reason = 'completed' }) {
    const work = requireWork(workSessionId);
    work.status = 'ending';
    work.endedAt = now();
    await publish({
      type: 'work_session_end',
      runtimeSessionId: work.runtimeSessionId,
      workSessionId: work.workSessionId,
      channel: work.channel,
      payload: { reason, status: 'ended' },
    });
    work.status = 'ended';
    workKeys.delete(`${work.channel}:${work.identityId}`);
    return snapshot(work);
  }

  async function endRuntime({ reason = 'quit' } = {}) {
    const activeRuntime = requireRuntime();
    for (const work of workSessions.values()) {
      if (work.status === 'active') {
        await endWork({ workSessionId: work.workSessionId, reason: 'runtime_end' });
      }
    }
    activeRuntime.status = 'ending';
    activeRuntime.endedAt = now();
    await publish({
      type: 'runtime_end',
      runtimeSessionId: activeRuntime.runtimeSessionId,
      payload: { reason, status: 'ended' },
    });
    activeRuntime.status = 'ended';
    return snapshot(activeRuntime);
  }

  async function recover() {
    const openRuntimes = new Map();
    const openWorks = new Map();

    for (const event of store.list()) {
      if (event.type === 'runtime_start') openRuntimes.set(event.runtimeSessionId, event);
      if (event.type === 'runtime_end') openRuntimes.delete(event.runtimeSessionId);
      if (event.type === 'work_session_start') openWorks.set(event.workSessionId, event);
      if (event.type === 'work_session_end') openWorks.delete(event.workSessionId);
    }

    let recoveredWorks = 0;
    for (const event of openWorks.values()) {
      if (!openRuntimes.has(event.runtimeSessionId)) continue;
      await publish({
        type: 'work_session_end',
        runtimeSessionId: event.runtimeSessionId,
        workSessionId: event.workSessionId,
        channel: event.channel,
        payload: { reason: 'crash_recovery', status: 'crashed' },
      });
      recoveredWorks += 1;
    }

    for (const runtimeSessionId of openRuntimes.keys()) {
      await publish({
        type: 'runtime_end',
        runtimeSessionId,
        payload: { reason: 'crash_recovery', status: 'crashed' },
      });
    }

    return Object.freeze({
      runtimeSessions: openRuntimes.size,
      workSessions: recoveredWorks,
    });
  }

  return Object.freeze({
    startRuntime,
    ready,
    startWork,
    beforeTurn,
    afterTurn,
    beforeTool,
    afterTool,
    checkpoint,
    endWork,
    endRuntime,
    recover,
  });
}
