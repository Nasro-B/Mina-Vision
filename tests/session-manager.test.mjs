import { describe, expect, it } from 'vitest';
import { createSessionManager } from '../src/sessions/session-manager.mjs';
import { createSessionStore } from '../src/sessions/session-store.mjs';

function createHarness({ initialNow = 0, checkpointEveryMs = 60_000, store = createSessionStore() } = {}) {
  let now = initialNow;
  let id = 0;
  const published = [];
  const hooks = Object.fromEntries([
    'runtime_start',
    'runtime_ready',
    'work_session_start',
    'before_turn',
    'after_turn',
    'before_tool',
    'after_tool',
    'checkpoint',
    'work_session_end',
    'runtime_end',
  ].map((type) => [type, (event) => published.push(event.type)]));

  const manager = createSessionManager({
    store,
    clock: () => now,
    ids: (kind) => `${kind}-${++id}`,
    hooks,
    checkpointEveryMs,
  });

  return {
    manager,
    published,
    store,
    advance(milliseconds) {
      now += milliseconds;
    },
  };
}

describe('session manager', () => {
  it('publishes lifecycle hooks in order and persists append-only events', async () => {
    const { manager, published, store } = createHarness();

    const runtime = await manager.startRuntime();
    expect(runtime.status).toBe('active');
    await manager.ready();
    const work = await manager.startWork({ channel: 'voice', identityId: 'owner-1', goal: 'Tester Mina' });
    await manager.beforeTurn({ workSessionId: work.workSessionId });
    await manager.afterTurn({ workSessionId: work.workSessionId });
    await manager.checkpoint({ workSessionId: work.workSessionId });
    const endedWork = await manager.endWork({ workSessionId: work.workSessionId, reason: 'completed' });
    const endedRuntime = await manager.endRuntime({ reason: 'quit' });

    expect(endedWork.status).toBe('ended');
    expect(endedRuntime.status).toBe('ended');
    expect(published).toEqual([
      'runtime_start',
      'runtime_ready',
      'work_session_start',
      'before_turn',
      'after_turn',
      'checkpoint',
      'work_session_end',
      'runtime_end',
    ]);
    expect(store.list().map((event) => event.type)).toEqual(published);
    expect(Object.isFrozen(store.list()[0])).toBe(true);
  });

  it('allows only one active runtime', async () => {
    const { manager } = createHarness();

    await manager.startRuntime();

    await expect(manager.startRuntime()).rejects.toThrow('runtime_already_active');
  });

  it('rejects nested work sessions for the same channel and identity', async () => {
    const { manager } = createHarness();
    await manager.startRuntime();
    await manager.ready();
    await manager.startWork({ channel: 'telegram', identityId: 'owner-1', goal: 'Premier échange' });

    await expect(manager.startWork({
      channel: 'telegram',
      identityId: 'owner-1',
      goal: 'Session imbriquée',
    })).rejects.toThrow('work_session_already_active');

    await expect(manager.startWork({
      channel: 'telegram',
      identityId: 'owner-2',
      goal: 'Autre identité',
    })).resolves.toMatchObject({ status: 'active' });
  });

  it('expires Telegram after thirty minutes of inactivity', async () => {
    const { manager, store, advance } = createHarness();
    await manager.startRuntime();
    await manager.ready();
    const work = await manager.startWork({ channel: 'telegram', identityId: 'owner-1', goal: 'Conversation' });

    advance(30 * 60_000 + 1);

    await expect(manager.beforeTurn({ workSessionId: work.workSessionId })).rejects.toThrow('work_session_expired');
    expect(store.list().at(-1)).toMatchObject({
      type: 'work_session_end',
      workSessionId: work.workSessionId,
      payload: { reason: 'idle_timeout', status: 'ended' },
    });
  });

  it('treats SMS as a one-turn micro-session', async () => {
    const { manager, store } = createHarness();
    await manager.startRuntime();
    await manager.ready();
    const work = await manager.startWork({ channel: 'sms', identityId: 'contact-1', goal: 'Préparer une réponse' });

    expect(work).toMatchObject({ microSession: true, toolsAllowed: false });
    await manager.beforeTurn({ workSessionId: work.workSessionId });
    await manager.afterTurn({ workSessionId: work.workSessionId });

    expect(store.list().at(-1)).toMatchObject({
      type: 'work_session_end',
      payload: { reason: 'sms_micro_session_complete', status: 'ended' },
    });
    await expect(manager.beforeTurn({ workSessionId: work.workSessionId })).rejects.toThrow('work_session_not_active');
  });

  it('checkpoints automatically only after the configured interval', async () => {
    const { manager, published, advance } = createHarness({ checkpointEveryMs: 1_000 });
    await manager.startRuntime();
    await manager.ready();
    const work = await manager.startWork({ channel: 'local', identityId: 'owner-1', goal: 'Mission' });

    advance(999);
    await manager.afterTurn({ workSessionId: work.workSessionId });
    expect(published.filter((type) => type === 'checkpoint')).toHaveLength(0);

    advance(1);
    await manager.afterTurn({ workSessionId: work.workSessionId });
    expect(published.filter((type) => type === 'checkpoint')).toHaveLength(1);
  });

  it('recovers crashed sessions without replaying action hooks', async () => {
    const first = createHarness();
    await first.manager.startRuntime();
    await first.manager.ready();
    const work = await first.manager.startWork({ channel: 'local', identityId: 'owner-1', goal: 'Action interrompue' });
    await first.manager.beforeTool({ workSessionId: work.workSessionId, tool: 'browser.click' });

    const recovery = createHarness({ store: first.store });
    const recovered = await recovery.manager.recover();

    expect(recovered).toMatchObject({ runtimeSessions: 1, workSessions: 1 });
    expect(recovery.published).toEqual(['work_session_end', 'runtime_end']);
    expect(first.store.list().slice(-2).map((event) => [event.type, event.payload.status])).toEqual([
      ['work_session_end', 'crashed'],
      ['runtime_end', 'crashed'],
    ]);
  });
});
