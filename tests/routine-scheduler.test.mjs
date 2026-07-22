import { describe, expect, it, vi } from 'vitest';
import { createRoutineScheduler, compileToAutomation } from '../src/routines/routine-scheduler.mjs';

function fakeRegistry(routines) {
  return { listRoutines: vi.fn(async () => routines) };
}

function fakeAutomationStore() {
  const calls = [];
  return {
    create: vi.fn(async (actions, options) => { calls.push({ actions, options }); return { actions, options }; }),
    createdActions: () => calls.flatMap((call) => call.actions),
    calls,
  };
}

function scheduledRoutine(overrides = {}) {
  return Object.freeze({
    routineId: 'r1', version: 1, status: 'active',
    trigger: { type: 'schedule', scheduleType: 'daily', hour: 9, minute: 0, timezone: 'Europe/Paris' },
    steps: [{ domain: 'telegram', operation: 'notify', capability: 'telegram:send_message', fixedValues: { chatId: '1' }, valueSchema: {} }],
    ...overrides,
  });
}

function eventRoutine(overrides = {}) {
  return Object.freeze({
    routineId: 'r-mail', version: 1, status: 'active',
    trigger: { type: 'event', eventType: 'mail' },
    steps: [{ domain: 'telegram', operation: 'notify', capability: 'telegram:send_message', fixedValues: { chatId: '1' }, valueSchema: { text: 'string' } }],
    ...overrides,
  });
}

describe('compileToAutomation: fixed domain/operation/capability, only declared values fillable', () => {
  it('ignores actions embedded in an incoming email event', async () => {
    const storedRoutine = eventRoutine();
    const automationStore = fakeAutomationStore();
    const scheduler = createRoutineScheduler({ registry: fakeRegistry([storedRoutine]), automationStore, clock: () => 0 });

    await scheduler.handleEvent({ type: 'mail', eventId: 'evt-1', data: { subject: 'Hi', actions: [{ operation: 'send' }] } });

    expect(automationStore.createdActions()).toEqual(
      compileToAutomation(storedRoutine, { eventData: { subject: 'Hi', actions: [{ operation: 'send' }] } }),
    );
    expect(automationStore.createdActions().every((action) => action.operation === 'notify')).toBe(true);
  });

  it('never lets event data override domain/operation/capability, even with matching key names', async () => {
    const routine = eventRoutine({
      steps: [{ domain: 'telegram', operation: 'notify', capability: 'telegram:send_message', fixedValues: {}, valueSchema: { text: 'string' } }],
    });
    const compiled = compileToAutomation(routine, { eventData: { domain: 'shell', operation: 'execute_script', capability: 'shell:rm-rf', text: 'ok' } });
    expect(compiled[0]).toEqual({ domain: 'telegram', operation: 'notify', capability: 'telegram:send_message', text: 'ok' });
  });

  it('ignores an event value whose type does not match the declared valueSchema type', () => {
    const routine = eventRoutine();
    const compiled = compileToAutomation(routine, { eventData: { text: 12345 } });
    expect(compiled[0].text).toBeUndefined();
  });

  it('fills fixedValues into every compiled action regardless of event data', () => {
    const routine = scheduledRoutine();
    const compiled = compileToAutomation(routine, {});
    expect(compiled[0]).toMatchObject({ domain: 'telegram', operation: 'notify', capability: 'telegram:send_message', chatId: '1' });
  });
});

describe('createRoutineScheduler.tick: daily schedule, DST-safe via Intl timezone conversion', () => {
  it('fires once the local wall-clock time in the routine timezone has passed, accounting for DST (summer offset UTC+2)', async () => {
    const automationStore = fakeAutomationStore();
    const scheduler = createRoutineScheduler({ registry: fakeRegistry([scheduledRoutine()]), automationStore, clock: () => 0 });
    // 07:30 UTC on 2026-07-15 is 09:30 in Europe/Paris (summer, UTC+2) -> past the 09:00 trigger -> due.
    // A naive fixed +1h (winter) offset would compute 08:30 and wrongly report "not yet due".
    await scheduler.tick(Date.parse('2026-07-15T07:30:00.000Z'));
    expect(automationStore.create).toHaveBeenCalledTimes(1);
  });

  it('does not fire before the local wall-clock time in winter (UTC+1)', async () => {
    const automationStore = fakeAutomationStore();
    const scheduler = createRoutineScheduler({ registry: fakeRegistry([scheduledRoutine()]), automationStore, clock: () => 0 });
    // 07:30 UTC on 2026-01-15 is 08:30 in Europe/Paris (winter, UTC+1) -> before the 09:00 trigger -> not due.
    await scheduler.tick(Date.parse('2026-01-15T07:30:00.000Z'));
    expect(automationStore.create).not.toHaveBeenCalled();
  });

  it('respects a different timezone per routine for the same UTC instant', async () => {
    const paris = scheduledRoutine({ routineId: 'r-paris' });
    const newYork = scheduledRoutine({ routineId: 'r-ny', trigger: { type: 'schedule', scheduleType: 'daily', hour: 9, minute: 0, timezone: 'America/New_York' } });
    const automationStore = fakeAutomationStore();
    const scheduler = createRoutineScheduler({ registry: fakeRegistry([paris, newYork]), automationStore, clock: () => 0 });
    // 07:30 UTC on 2026-07-15: Paris (UTC+2 in July) = 09:30 -> due. New York (UTC-4 in July) = 03:30 -> not due.
    await scheduler.tick(Date.parse('2026-07-15T07:30:00.000Z'));
    const firedIds = automationStore.calls.map((call) => call.options.idempotencyKey.split(':')[0]);
    expect(firedIds).toContain('r-paris');
    expect(firedIds).not.toContain('r-ny');
  });

  it('duplicate tick on the same day fires at most once (idempotent by date slot)', async () => {
    const automationStore = fakeAutomationStore();
    const scheduler = createRoutineScheduler({ registry: fakeRegistry([scheduledRoutine()]), automationStore, clock: () => 0 });
    await scheduler.tick(Date.parse('2026-07-15T07:30:00.000Z'));
    await scheduler.tick(Date.parse('2026-07-15T12:00:00.000Z'));
    expect(automationStore.create).toHaveBeenCalledTimes(1);
  });

  it('a late trigger (tick called well after the scheduled time) still fires exactly once', async () => {
    const automationStore = fakeAutomationStore();
    const scheduler = createRoutineScheduler({ registry: fakeRegistry([scheduledRoutine()]), automationStore, clock: () => 0 });
    // First tick of the day arrives at 14:00 Paris local (server was asleep) -- still past 09:00, must catch up.
    await scheduler.tick(Date.parse('2026-07-15T12:00:00.000Z'));
    expect(automationStore.create).toHaveBeenCalledTimes(1);
  });

  it('fires again on the next calendar day (new slot)', async () => {
    const automationStore = fakeAutomationStore();
    const scheduler = createRoutineScheduler({ registry: fakeRegistry([scheduledRoutine()]), automationStore, clock: () => 0 });
    await scheduler.tick(Date.parse('2026-07-15T07:30:00.000Z'));
    await scheduler.tick(Date.parse('2026-07-16T07:30:00.000Z'));
    expect(automationStore.create).toHaveBeenCalledTimes(2);
  });

  it('skips a paused routine', async () => {
    const automationStore = fakeAutomationStore();
    const scheduler = createRoutineScheduler({ registry: fakeRegistry([scheduledRoutine({ status: 'paused' })]), automationStore, clock: () => 0 });
    await scheduler.tick(Date.parse('2026-07-15T12:00:00.000Z'));
    expect(automationStore.create).not.toHaveBeenCalled();
  });

  it('skips an event-triggered routine during tick', async () => {
    const automationStore = fakeAutomationStore();
    const scheduler = createRoutineScheduler({ registry: fakeRegistry([eventRoutine()]), automationStore, clock: () => 0 });
    await scheduler.tick(Date.parse('2026-07-15T12:00:00.000Z'));
    expect(automationStore.create).not.toHaveBeenCalled();
  });

  it('uses the exact idempotence key format routineId:scheduleSlot:definitionVersion', async () => {
    const automationStore = fakeAutomationStore();
    const scheduler = createRoutineScheduler({ registry: fakeRegistry([scheduledRoutine()]), automationStore, clock: () => 0 });
    await scheduler.tick(Date.parse('2026-07-15T12:00:00.000Z'));
    expect(automationStore.calls[0].options.idempotencyKey).toBe('r1:2026-07-15:1');
  });
});

describe('createRoutineScheduler.handleEvent', () => {
  it('skips a schedule-triggered routine when handling an event', async () => {
    const automationStore = fakeAutomationStore();
    const scheduler = createRoutineScheduler({ registry: fakeRegistry([scheduledRoutine()]), automationStore, clock: () => 0 });
    await scheduler.handleEvent({ type: 'mail', eventId: 'e1', data: {} });
    expect(automationStore.create).not.toHaveBeenCalled();
  });

  it('skips an event routine whose eventType does not match', async () => {
    const automationStore = fakeAutomationStore();
    const scheduler = createRoutineScheduler({ registry: fakeRegistry([eventRoutine()]), automationStore, clock: () => 0 });
    await scheduler.handleEvent({ type: 'sms', eventId: 'e1', data: {} });
    expect(automationStore.create).not.toHaveBeenCalled();
  });

  it('is idempotent for the same eventId handled twice', async () => {
    const automationStore = fakeAutomationStore();
    const scheduler = createRoutineScheduler({ registry: fakeRegistry([eventRoutine()]), automationStore, clock: () => 0 });
    await scheduler.handleEvent({ type: 'mail', eventId: 'e1', data: { text: 'ok' } });
    await scheduler.handleEvent({ type: 'mail', eventId: 'e1', data: { text: 'ok' } });
    expect(automationStore.create).toHaveBeenCalledTimes(1);
  });
});
