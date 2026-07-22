import { describe, expect, it, vi } from 'vitest';
import { createDailyBriefingService } from '../src/personal/daily-briefing-service.mjs';

const NOW = Date.parse('2026-07-16T08:00:00.000Z');

describe('createDailyBriefingService: constructor guards', () => {
  it('requires a clock', () => {
    expect(() => createDailyBriefingService({})).toThrow('daily_briefing_service_clock_required');
  });
});

describe('createDailyBriefingService.build: with no sources configured', () => {
  it('returns an empty but well-formed briefing', async () => {
    const service = createDailyBriefingService({ clock: () => NOW });
    const briefing = await service.build({ identityId: 'owner', asOf: NOW, channel: 'telegram' });
    expect(briefing).toMatchObject({ identityId: 'owner', asOf: NOW, channel: 'telegram', items: [], staleItems: [] });
  });

  it('requires an identityId', async () => {
    const service = createDailyBriefingService({ clock: () => NOW });
    await expect(service.build({ asOf: NOW, channel: 'telegram' })).rejects.toThrow('daily_briefing_identity_id_required');
  });
});

describe('createDailyBriefingService.build: every item is grounded (sourceRef + observedAt)', () => {
  it('every item carries a sourceRef and an observedAt', async () => {
    const calendarService = { list: vi.fn(async () => ([
      { eventId: 'e1', title: 'RDV', startAt: '2026-07-16T09:00:00.000Z', syncedAt: NOW },
    ])) };
    const taskRepository = { list: vi.fn(async () => ([
      { taskId: 't1', title: 'Rappeler Alice', status: 'active' },
    ])) };
    const service = createDailyBriefingService({ calendarService, taskRepository, clock: () => NOW });
    const briefing = await service.build({ identityId: 'owner', asOf: NOW, channel: 'telegram' });
    expect(briefing.items.every((item) => item.sourceRef && item.observedAt)).toBe(true);
    expect(briefing.items.map((item) => item.section)).toEqual(['confirmed_facts', 'confirmed_facts']);
  });
});

describe('createDailyBriefingService.build: stale data is bucketed separately with a labeled reason', () => {
  it('buckets an item older than 24h as stale, with a label mentioning the last data point', async () => {
    const staleSyncedAt = NOW - 48 * 60 * 60 * 1000;
    const calendarService = { list: vi.fn(async () => ([
      { eventId: 'e-old', title: 'Ancien événement', startAt: '2026-07-14T09:00:00.000Z', syncedAt: staleSyncedAt },
    ])) };
    const service = createDailyBriefingService({ calendarService, clock: () => NOW });
    const briefing = await service.build({ identityId: 'owner', asOf: NOW, channel: 'telegram' });
    expect(briefing.items).toEqual([]);
    expect(briefing.staleItems).toHaveLength(1);
    expect(briefing.staleItems.every((entry) => entry.label.includes('Dernière donnée'))).toBe(true);
  });

  it('keeps a fresh item (under 24h) in the main items list, not staleItems', async () => {
    const calendarService = { list: vi.fn(async () => ([
      { eventId: 'e-fresh', title: 'RDV', startAt: '2026-07-16T09:00:00.000Z', syncedAt: NOW - 1000 },
    ])) };
    const service = createDailyBriefingService({ calendarService, clock: () => NOW });
    const briefing = await service.build({ identityId: 'owner', asOf: NOW, channel: 'telegram' });
    expect(briefing.items).toHaveLength(1);
    expect(briefing.staleItems).toEqual([]);
  });
});

describe('createDailyBriefingService.build: the six documented sections', () => {
  it('surfaces a failed health probe under blocked_ambiguous', async () => {
    const healthMonitor = { snapshot: vi.fn(() => ([
      { probeId: 'lmstudio', status: 'failed', observedAt: NOW, suggestion: 'Vérifier LM Studio.' },
      { probeId: 'adb', status: 'ok', observedAt: NOW, suggestion: null },
    ])) };
    const service = createDailyBriefingService({ healthMonitor, clock: () => NOW });
    const briefing = await service.build({ identityId: 'owner', asOf: NOW, channel: 'telegram' });
    expect(briefing.items).toHaveLength(1);
    expect(briefing.items[0]).toMatchObject({ section: 'blocked_ambiguous', sourceRef: 'health:lmstudio' });
  });

  it('surfaces an active scheduled routine under planned_automations', async () => {
    const routineRegistry = { listRoutines: vi.fn(async () => ([
      { routineId: 'r1', name: 'Rappel arrosage', status: 'active', trigger: { type: 'schedule' } },
      { routineId: 'r2', name: 'Sur événement', status: 'active', trigger: { type: 'event' } },
      { routineId: 'r3', name: 'En pause', status: 'paused', trigger: { type: 'schedule' } },
    ])) };
    const service = createDailyBriefingService({ routineRegistry, clock: () => NOW });
    const briefing = await service.build({ identityId: 'owner', asOf: NOW, channel: 'telegram' });
    expect(briefing.items).toHaveLength(1);
    expect(briefing.items[0]).toMatchObject({ section: 'planned_automations', sourceRef: 'routine:r1' });
  });

  it('surfaces the remaining daily budget', async () => {
    const budgetGuard = { snapshot: vi.fn(async () => ({ remainingMicros: 5000 })) };
    const service = createDailyBriefingService({ budgetGuard, clock: () => NOW });
    const briefing = await service.build({ identityId: 'owner', asOf: NOW, channel: 'telegram' });
    expect(briefing.items[0]).toMatchObject({ section: 'remaining_budget', sourceRef: 'budget:daily' });
  });

  it('never crashes when only some sources are configured', async () => {
    const service = createDailyBriefingService({ budgetGuard: { snapshot: vi.fn(async () => ({ remainingMicros: null })) }, clock: () => NOW });
    const briefing = await service.build({ identityId: 'owner', asOf: NOW, channel: 'telegram' });
    expect(briefing.items).toHaveLength(1);
  });
});
