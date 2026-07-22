import { describe, expect, it } from 'vitest';
import { createAutomationDefinitionStore } from '../src/automation/automation-definition-store.mjs';

function validDefinition(overrides = {}) {
  return { name: 'Rappel arrosage', description: 'Rappelle d\'arroser les plantes le lundi', status: 'draft', ...overrides };
}

function fakeRepo() {
  const rows = new Map();
  return {
    async put(id, record) { rows.set(id, record); },
    async get(id) { return rows.get(id) ?? null; },
    async list() { return [...rows.values()]; },
  };
}

function fakeClock(startMs) {
  let current = startMs;
  return { now: () => current, advance(ms) { current += ms; } };
}

describe('createAutomationDefinitionStore: constructor guards', () => {
  it('requires a repository with put/get/list', () => {
    expect(() => createAutomationDefinitionStore({ clock: fakeClock(0) })).toThrow('automation_definition_store_repository_required');
  });

  it('requires a clock', () => {
    expect(() => createAutomationDefinitionStore({ repository: fakeRepo() })).toThrow('automation_definition_store_clock_required');
  });

  it('accepts a bare function clock, not only a {now()} object', async () => {
    const store = createAutomationDefinitionStore({ repository: fakeRepo(), clock: () => 1000 });
    const item = await store.create(validDefinition());
    expect(item.createdAt).toBe(new Date(1000).toISOString());
  });
});

describe('createAutomationDefinitionStore: create', () => {
  it('assigns automationId, version 1, null previousStatus and matching created/changed timestamps', async () => {
    const clock = fakeClock(1_700_000_000_000);
    const store = createAutomationDefinitionStore({ repository: fakeRepo(), clock });
    const item = await store.create(validDefinition());
    expect(typeof item.automationId).toBe('string');
    expect(item.automationId.length).toBeGreaterThan(0);
    expect(item.status).toBe('draft');
    expect(item.version).toBe(1);
    expect(item.previousStatus).toBeNull();
    expect(item.createdAt).toBe(new Date(1_700_000_000_000).toISOString());
    expect(item.changedAt).toBe(item.createdAt);
  });

  it('freezes the returned record', async () => {
    const store = createAutomationDefinitionStore({ repository: fakeRepo(), clock: fakeClock(0) });
    const item = await store.create(validDefinition());
    expect(Object.isFrozen(item)).toBe(true);
  });

  it('rejects a creation input whose status is not draft', async () => {
    const store = createAutomationDefinitionStore({ repository: fakeRepo(), clock: fakeClock(0) });
    await expect(store.create(validDefinition({ status: 'active' }))).rejects.toThrow('automation_definition_must_start_draft');
  });

  it('rejects a malformed input via the shared contract validator', async () => {
    const store = createAutomationDefinitionStore({ repository: fakeRepo(), clock: fakeClock(0) });
    await expect(store.create({ ...validDefinition(), name: '' })).rejects.toThrow();
  });
});

describe('createAutomationDefinitionStore: list', () => {
  it('lists every created definition', async () => {
    const store = createAutomationDefinitionStore({ repository: fakeRepo(), clock: fakeClock(0) });
    const a = await store.create(validDefinition({ name: 'A' }));
    const b = await store.create(validDefinition({ name: 'B' }));
    expect((await store.list()).map((item) => item.automationId).sort()).toEqual([a.automationId, b.automationId].sort());
  });

  it('returns an empty array when nothing has been created', async () => {
    const store = createAutomationDefinitionStore({ repository: fakeRepo(), clock: fakeClock(0) });
    expect(await store.list()).toEqual([]);
  });
});

describe('createAutomationDefinitionStore: get', () => {
  it('returns null for an unknown automationId', async () => {
    const store = createAutomationDefinitionStore({ repository: fakeRepo(), clock: fakeClock(0) });
    expect(await store.get('does-not-exist')).toBeNull();
  });

  it('returns the stored record for a known automationId', async () => {
    const store = createAutomationDefinitionStore({ repository: fakeRepo(), clock: fakeClock(0) });
    const created = await store.create(validDefinition());
    expect(await store.get(created.automationId)).toEqual(created);
  });
});

describe('createAutomationDefinitionStore: transition', () => {
  it('rejects activation before shadow and supervision', async () => {
    const store = createAutomationDefinitionStore({ repository: fakeRepo(), clock: fakeClock(0) });
    const item = await store.create(validDefinition({ status: 'draft' }));
    await expect(store.transition(item.automationId, 'active')).rejects.toThrow('invalid_automation_transition');
  });

  it('walks the full lifecycle draft -> shadow -> supervised -> active -> suspended -> shadow -> revoked', async () => {
    const clock = fakeClock(0);
    const store = createAutomationDefinitionStore({ repository: fakeRepo(), clock });
    const created = await store.create(validDefinition());
    const path = ['shadow', 'supervised', 'active', 'suspended', 'shadow', 'revoked'];
    let current = created;
    for (const nextStatus of path) {
      clock.advance(1000);
      // eslint-disable-next-line no-await-in-loop
      current = await store.transition(current.automationId, nextStatus);
      expect(current.status).toBe(nextStatus);
    }
    expect(current.version).toBe(created.version + path.length);
  });

  it('records previousStatus and bumps changedAt on every transition', async () => {
    const clock = fakeClock(5000);
    const store = createAutomationDefinitionStore({ repository: fakeRepo(), clock });
    const created = await store.create(validDefinition());
    clock.advance(2500);
    const next = await store.transition(created.automationId, 'shadow');
    expect(next.previousStatus).toBe('draft');
    expect(next.version).toBe(2);
    expect(next.changedAt).toBe(new Date(7500).toISOString());
    expect(next.createdAt).toBe(created.createdAt);
  });

  it('rejects any transition attempted from the terminal revoked state', async () => {
    const store = createAutomationDefinitionStore({ repository: fakeRepo(), clock: fakeClock(0) });
    const created = await store.create(validDefinition());
    const revoked = await store.transition(created.automationId, 'revoked');
    await expect(store.transition(revoked.automationId, 'shadow')).rejects.toThrow('invalid_automation_transition');
  });

  it('rejects a transition for an unknown automationId', async () => {
    const store = createAutomationDefinitionStore({ repository: fakeRepo(), clock: fakeClock(0) });
    await expect(store.transition('does-not-exist', 'shadow')).rejects.toThrow('automation_definition_not_found');
  });

  it('rejects a stale expectedVersion instead of silently overwriting a concurrent change', async () => {
    const store = createAutomationDefinitionStore({ repository: fakeRepo(), clock: fakeClock(0) });
    const created = await store.create(validDefinition());
    await store.transition(created.automationId, 'shadow');
    await expect(store.transition(created.automationId, 'suspended', { expectedVersion: created.version }))
      .rejects.toThrow('automation_definition_version_stale');
  });

  it('accepts a transition when expectedVersion matches the current version', async () => {
    const store = createAutomationDefinitionStore({ repository: fakeRepo(), clock: fakeClock(0) });
    const created = await store.create(validDefinition());
    const next = await store.transition(created.automationId, 'shadow', { expectedVersion: created.version });
    expect(next.status).toBe('shadow');
  });
});

describe('createAutomationDefinitionStore: revoke', () => {
  it('is a shortcut for transitioning straight to revoked from any non-terminal status', async () => {
    const store = createAutomationDefinitionStore({ repository: fakeRepo(), clock: fakeClock(0) });
    const created = await store.create(validDefinition());
    const revoked = await store.revoke(created.automationId);
    expect(revoked.status).toBe('revoked');
    expect(revoked.previousStatus).toBe('draft');
  });

  it('propagates expectedVersion so a stale caller cannot revoke past a concurrent change', async () => {
    const store = createAutomationDefinitionStore({ repository: fakeRepo(), clock: fakeClock(0) });
    const created = await store.create(validDefinition());
    await store.transition(created.automationId, 'shadow');
    await expect(store.revoke(created.automationId, { expectedVersion: created.version }))
      .rejects.toThrow('automation_definition_version_stale');
  });
});
