import { describe, expect, it } from 'vitest';
import { validateRoutineInput, ROUTINE_STATUSES } from '../src/routines/routine-contracts.mjs';
import { createRoutineRegistry } from '../src/routines/routine-registry.mjs';

function fakeRepository() {
  const rows = new Map();
  return {
    async put(id, record) { rows.set(id, record); },
    async get(id) { return rows.get(id) ?? null; },
    async list() { return [...rows.values()]; },
  };
}

function scheduleTrigger(overrides = {}) {
  return { type: 'schedule', scheduleType: 'daily', hour: 9, minute: 0, timezone: 'Europe/Paris', ...overrides };
}

function step(overrides = {}) {
  return { domain: 'telegram', operation: 'notify', capability: 'telegram:send_message', fixedValues: { chatId: '1' }, valueSchema: { text: 'string' }, ...overrides };
}

function validInput(overrides = {}) {
  return { name: 'Rappel arrosage', trigger: scheduleTrigger(), steps: [step()], ...overrides };
}

describe('ROUTINE_STATUSES', () => {
  it('lists exactly active and paused', () => {
    expect([...ROUTINE_STATUSES]).toEqual(['active', 'paused']);
  });
});

describe('validateRoutineInput', () => {
  it('accepts a well-formed routine and defaults status to active', () => {
    const routine = validateRoutineInput(validInput());
    expect(routine.status).toBe('active');
    expect(Object.isFrozen(routine)).toBe(true);
  });

  it('requires at least one step', () => {
    expect(() => validateRoutineInput(validInput({ steps: [] }))).toThrow();
  });

  it('caps steps at 20', () => {
    expect(() => validateRoutineInput(validInput({ steps: Array.from({ length: 21 }, () => step()) }))).toThrow();
  });

  it('accepts a schedule trigger', () => {
    const routine = validateRoutineInput(validInput({ trigger: scheduleTrigger({ hour: 23, minute: 59 }) }));
    expect(routine.trigger).toMatchObject({ type: 'schedule', hour: 23, minute: 59 });
  });

  it('accepts an event trigger', () => {
    const routine = validateRoutineInput(validInput({ trigger: { type: 'event', eventType: 'mail' } }));
    expect(routine.trigger).toEqual({ type: 'event', eventType: 'mail' });
  });

  it('rejects an unknown trigger type', () => {
    expect(() => validateRoutineInput(validInput({ trigger: { type: 'webhook' } }))).toThrow();
  });

  it('rejects a step with an unknown valueSchema field type', () => {
    expect(() => validateRoutineInput(validInput({ steps: [step({ valueSchema: { text: 'object' } })] }))).toThrow();
  });

  it('defaults fixedValues and valueSchema to empty objects when omitted', () => {
    const routine = validateRoutineInput(validInput({ steps: [{ domain: 'telegram', operation: 'notify', capability: 'telegram:send_message' }] }));
    expect(routine.steps[0].fixedValues).toEqual({});
    expect(routine.steps[0].valueSchema).toEqual({});
  });
});

describe('createRoutineRegistry: constructor guards', () => {
  it('requires a repository', () => {
    expect(() => createRoutineRegistry({ clock: () => 0 })).toThrow('routine_registry_repository_required');
  });

  it('requires a clock', () => {
    expect(() => createRoutineRegistry({ repository: fakeRepository() })).toThrow('routine_registry_clock_required');
  });
});

describe('createRoutineRegistry: createRoutine / getRoutine / listRoutines', () => {
  it('creates a routine with a generated id, version 1, and validates the input', async () => {
    const registry = createRoutineRegistry({ repository: fakeRepository(), clock: () => 1_700_000_000_000 });
    const routine = await registry.createRoutine(validInput());
    expect(typeof routine.routineId).toBe('string');
    expect(routine.version).toBe(1);
    expect(routine.status).toBe('active');
  });

  it('rejects an invalid routine input via the shared contract validator', async () => {
    const registry = createRoutineRegistry({ repository: fakeRepository(), clock: () => 0 });
    await expect(registry.createRoutine(validInput({ steps: [] }))).rejects.toThrow();
  });

  it('getRoutine returns null for an unknown id', async () => {
    const registry = createRoutineRegistry({ repository: fakeRepository(), clock: () => 0 });
    expect(await registry.getRoutine('missing')).toBeNull();
  });

  it('listRoutines lists every created routine', async () => {
    const registry = createRoutineRegistry({ repository: fakeRepository(), clock: () => 0 });
    await registry.createRoutine(validInput({ name: 'A' }));
    await registry.createRoutine(validInput({ name: 'B' }));
    expect(await registry.listRoutines()).toHaveLength(2);
  });
});

describe('createRoutineRegistry.setStatus', () => {
  it('pauses an active routine and bumps its version', async () => {
    const registry = createRoutineRegistry({ repository: fakeRepository(), clock: () => 0 });
    const routine = await registry.createRoutine(validInput());
    const paused = await registry.setStatus(routine.routineId, 'paused');
    expect(paused.status).toBe('paused');
    expect(paused.version).toBe(2);
  });

  it('rejects setting status on an unknown routine', async () => {
    const registry = createRoutineRegistry({ repository: fakeRepository(), clock: () => 0 });
    await expect(registry.setStatus('missing', 'paused')).rejects.toThrow('routine_not_found');
  });
});
