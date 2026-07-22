import { describe, expect, it } from 'vitest';
import { createAutomationGrantStore } from '../src/automation/automation-grant-store.mjs';

const DIGEST = 'a'.repeat(64);

function validGrant(overrides = {}) {
  return {
    automationId: 'def-1',
    digest: DIGEST,
    expiresAt: '2026-08-01T00:00:00.000Z',
    resourceScope: ['telegram:send_message'],
    channelScope: ['telegram'],
    schedule: null,
    maxRiskLevel: 2,
    maxFrequencyPerWindow: 3,
    maxCostMicros: 1_000_000,
    maxDurationMs: 5000,
    ...overrides,
  };
}

function fakeRepo() {
  const rows = new Map();
  return {
    async put(id, record) { rows.set(id, record); },
    async get(id) { return rows.get(id) ?? null; },
    async list() { return [...rows.values()]; },
  };
}

describe('createAutomationGrantStore: constructor guards', () => {
  it('requires a repository', () => {
    expect(() => createAutomationGrantStore({ clock: () => 0 })).toThrow('automation_grant_store_repository_required');
  });

  it('requires a clock', () => {
    expect(() => createAutomationGrantStore({ repository: fakeRepo() })).toThrow('automation_grant_store_clock_required');
  });
});

describe('createAutomationGrantStore: create', () => {
  it('assigns grantId and createdAt, freezes the record, and persists every limit field', async () => {
    const store = createAutomationGrantStore({ repository: fakeRepo(), clock: () => 1_700_000_000_000 });
    const grant = await store.create(validGrant());
    expect(typeof grant.grantId).toBe('string');
    expect(grant.grantId.length).toBeGreaterThan(0);
    expect(grant.createdAt).toBe(new Date(1_700_000_000_000).toISOString());
    expect(grant.maxCostMicros).toBe(1_000_000);
    expect(Object.isFrozen(grant)).toBe(true);
  });

  it('rejects a grant missing expiresAt', async () => {
    const store = createAutomationGrantStore({ repository: fakeRepo(), clock: () => 0 });
    const { expiresAt, ...rest } = validGrant();
    await expect(store.create(rest)).rejects.toThrow();
  });

  it('rejects a grant with a non-positive limit', async () => {
    const store = createAutomationGrantStore({ repository: fakeRepo(), clock: () => 0 });
    await expect(store.create(validGrant({ maxCostMicros: 0 }))).rejects.toThrow();
  });

  it('rejects a grant with an empty resourceScope', async () => {
    const store = createAutomationGrantStore({ repository: fakeRepo(), clock: () => 0 });
    await expect(store.create(validGrant({ resourceScope: [] }))).rejects.toThrow();
  });

  it('rejects a digest that is not a 64-character hex string', async () => {
    const store = createAutomationGrantStore({ repository: fakeRepo(), clock: () => 0 });
    await expect(store.create(validGrant({ digest: 'not-a-digest' }))).rejects.toThrow();
  });
});

describe('createAutomationGrantStore: get and listByAutomation', () => {
  it('returns null for an unknown grantId', async () => {
    const store = createAutomationGrantStore({ repository: fakeRepo(), clock: () => 0 });
    expect(await store.get('missing')).toBeNull();
  });

  it('lists only grants for the requested automationId', async () => {
    const store = createAutomationGrantStore({ repository: fakeRepo(), clock: () => 0 });
    const a = await store.create(validGrant({ automationId: 'def-a' }));
    await store.create(validGrant({ automationId: 'def-b' }));
    const listed = await store.listByAutomation('def-a');
    expect(listed).toEqual([a]);
  });
});
