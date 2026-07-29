import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyPersonalCalendarMigrations, createCalendarRepository } from '../src/personal/calendar-repository.mjs';
import { createCalendarService } from '../src/personal/calendar-service.mjs';

let db;
let directory;
let repository;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'mina-calendar-service-'));
  db = new Database(join(directory, 'personal-calendar.sqlite'));
  applyPersonalCalendarMigrations(db);
  repository = createCalendarRepository({ db, clock: () => 1_700_000_000_000 });
});

afterEach(async () => {
  if (db?.open) db.close();
  await rm(directory, { recursive: true, force: true });
});

function fakeProvider(overrides = {}) {
  const provider = {
    revision: 'r1',
    capabilities: Object.freeze(['sync', 'createEvent', 'getEvent', 'updateEvent', 'cancelEvent']),
    createEvent: vi.fn(async (input) => Object.freeze({ eventId: 'e1', revision: 'r1' })),
    updateEvent: vi.fn(async ({ eventId, patch }) => Object.freeze({ eventId, revision: 'r2' })),
    cancelEvent: vi.fn(async (eventId) => Object.freeze({ eventId, cancelled: true })),
    getEvent: vi.fn(async (eventId) => Object.freeze({
      eventId, providerId: 'google', calendarId: 'primary', title: 'RDV',
      startAt: '2026-07-20T09:00:00.000Z', endAt: '2026-07-20T10:00:00.000Z', allDay: false, attendees: [],
      get revision() { return provider.revision; },
    })),
    ...overrides,
  };
  return provider;
}

function fakeHub(provider) {
  return { adapter: vi.fn((id) => { if (id !== 'google') throw new Error('adapter_not_found'); return provider; }) };
}

const allowingBroker = { authorize: vi.fn(async () => ({ decision: 'allow', reason: 'ok' })) };
const allowingConfirmation = { confirm: vi.fn(async () => true) };
const confirmedVerifier = { verify: vi.fn(async () => ({ confirmed: true })) };

function buildService(overrides = {}) {
  return createCalendarService({
    hub: fakeHub(fakeProvider()), repository, capabilityBroker: allowingBroker,
    actionVerifier: confirmedVerifier, confirmationService: allowingConfirmation, clock: () => 1_700_000_000_000,
    ...overrides,
  });
}

describe('createCalendarService: constructor guards', () => {
  it('requires a hub', () => {
    expect(() => createCalendarService({ repository, capabilityBroker: allowingBroker, actionVerifier: confirmedVerifier, confirmationService: allowingConfirmation, clock: () => 0 }))
      .toThrow('calendar_service_hub_required');
  });
});

describe('createCalendarService: sync with bounded resync on expired cursor', () => {
  it('persists synced items and stores the returned cursor', async () => {
    const provider = fakeProvider();
    provider.sync = vi.fn(async () => ({
      items: [{ eventId: 'e1', providerId: 'google', calendarId: 'primary', title: 'RDV', description: '', location: '', startAt: '2026-07-20T09:00:00.000Z', endAt: '2026-07-20T10:00:00.000Z', allDay: false, attendees: [], revision: 'r1' }],
      removedIds: [], cursor: 'sync-2', hasMore: false,
    }));
    const service = buildService({ hub: fakeHub(provider) });
    await service.sync('google');
    expect(await repository.get('e1')).toMatchObject({ title: 'RDV' });
    expect(await repository.getCursor('google')).toBe('sync-2');
  });

  it('deletes removed items locally', async () => {
    await repository.put({ eventId: 'gone', providerId: 'google', calendarId: 'primary', title: 'X', startAt: '2026-07-20T09:00:00.000Z', endAt: '2026-07-20T10:00:00.000Z', allDay: false, attendees: [], revision: 'r0' });
    const provider = fakeProvider();
    provider.sync = vi.fn(async () => ({ items: [], removedIds: ['gone'], cursor: 'sync-2', hasMore: false }));
    const service = buildService({ hub: fakeHub(provider) });
    await service.sync('google');
    expect(await repository.get('gone')).toBeNull();
  });

  it('performs exactly one bounded resync when the cursor has expired, never loops unbounded', async () => {
    await repository.setCursor('google', 'stale-cursor');
    const provider = fakeProvider();
    provider.sync = vi.fn(async ({ cursor }) => {
      if (cursor === 'stale-cursor') throw new Error('personal_sync_resync_required');
      return { items: [], removedIds: [], cursor: 'fresh-cursor', hasMore: false };
    });
    const service = buildService({ hub: fakeHub(provider) });
    await service.sync('google');
    expect(provider.sync).toHaveBeenCalledTimes(2);
    expect(await repository.getCursor('google')).toBe('fresh-cursor');
  });

  it('propagates a second consecutive resync-required as a real failure rather than looping forever', async () => {
    const provider = fakeProvider();
    provider.sync = vi.fn(async () => { throw new Error('personal_sync_resync_required'); });
    const service = buildService({ hub: fakeHub(provider) });
    await expect(service.sync('google')).rejects.toThrow('personal_sync_resync_required');
    expect(provider.sync).toHaveBeenCalledTimes(2);
  });
});

describe('createCalendarService: list/get', () => {
  it('lists events from the local repository within a window', async () => {
    await repository.put({ eventId: 'e1', providerId: 'google', calendarId: 'primary', title: 'RDV', startAt: '2026-07-20T09:00:00.000Z', endAt: '2026-07-20T10:00:00.000Z', allDay: false, attendees: [], revision: 'r1' });
    const service = buildService();
    const results = await service.list({ from: '2026-07-19T00:00:00.000Z', to: '2026-07-21T00:00:00.000Z' });
    expect(results.map((entry) => entry.eventId)).toEqual(['e1']);
  });

  it('get returns null for an unknown event', async () => {
    expect(await buildService().get('missing')).toBeNull();
  });
});

describe('createCalendarService: proposeCreate / commitProposal', () => {
  it('does not call the provider until commitProposal is called', async () => {
    const provider = fakeProvider();
    const service = buildService({ hub: fakeHub(provider) });
    const proposal = await service.proposeCreate({ providerId: 'google', calendarId: 'primary', title: 'RDV', startAt: '2026-07-20T09:00:00.000Z', endAt: '2026-07-20T10:00:00.000Z' });
    expect(proposal.status).toBe('proposed');
    expect(provider.createEvent).not.toHaveBeenCalled();
  });

  it('refuses a provider mutation missing from capability metadata before confirmation or a local write', async () => {
    const provider = fakeProvider({ capabilities: Object.freeze(['sync']) });
    const confirmationService = { confirm: vi.fn(async () => true) };
    const service = buildService({ hub: fakeHub(provider), confirmationService });
    const proposal = await service.proposeCreate({ providerId: 'google', calendarId: 'primary', title: 'RDV', startAt: '2026-07-20T09:00:00.000Z', endAt: '2026-07-20T10:00:00.000Z' });

    await expect(service.commitProposal(proposal.proposalId)).rejects.toThrow('personal_action_unsupported_by_provider:createEvent');
    expect(confirmationService.confirm).not.toHaveBeenCalled();
    expect(provider.createEvent).not.toHaveBeenCalled();
    expect(await repository.list()).toEqual([]);
  });

  it('commits a create proposal: calls createEvent, verifies via getEvent, and persists locally', async () => {
    const provider = fakeProvider();
    const service = buildService({ hub: fakeHub(provider) });
    const proposal = await service.proposeCreate({ providerId: 'google', calendarId: 'primary', title: 'RDV', startAt: '2026-07-20T09:00:00.000Z', endAt: '2026-07-20T10:00:00.000Z' });
    const committed = await service.commitProposal(proposal.proposalId);
    expect(provider.createEvent).toHaveBeenCalledTimes(1);
    expect(provider.getEvent).toHaveBeenCalledWith('e1');
    expect(committed.eventId).toBe('e1');
    expect(await repository.get('e1')).toMatchObject({ title: 'RDV' });
  });

  it('requires local confirmation before writing to the provider', async () => {
    const confirmationService = { confirm: vi.fn(async () => false) };
    const provider = fakeProvider();
    const service = buildService({ hub: fakeHub(provider), confirmationService });
    const proposal = await service.proposeCreate({ providerId: 'google', calendarId: 'primary', title: 'RDV', startAt: '2026-07-20T09:00:00.000Z', endAt: '2026-07-20T10:00:00.000Z' });
    await expect(service.commitProposal(proposal.proposalId)).rejects.toThrow('confirmation_refused');
    expect(provider.createEvent).not.toHaveBeenCalled();
  });

  it('rejects committing an unknown proposalId', async () => {
    await expect(buildService().commitProposal('missing')).rejects.toThrow('proposal_not_found');
  });

  it('rejects committing the same proposal twice', async () => {
    const provider = fakeProvider();
    const service = buildService({ hub: fakeHub(provider) });
    const proposal = await service.proposeCreate({ providerId: 'google', calendarId: 'primary', title: 'RDV', startAt: '2026-07-20T09:00:00.000Z', endAt: '2026-07-20T10:00:00.000Z' });
    await service.commitProposal(proposal.proposalId);
    await expect(service.commitProposal(proposal.proposalId)).rejects.toThrow('proposal_not_found');
  });
});

describe('createCalendarService: proposeUpdate / commitProposal — optimistic concurrency', () => {
  it('does not overwrite after provider revision changes', async () => {
    await repository.put({ eventId: 'e1', providerId: 'google', calendarId: 'primary', title: 'A', startAt: '2026-07-20T09:00:00.000Z', endAt: '2026-07-20T10:00:00.000Z', allDay: false, attendees: [], revision: 'r1' });
    const provider = fakeProvider();
    const service = buildService({ hub: fakeHub(provider) });

    const proposal = await service.proposeUpdate({ eventId: 'e1', patch: { title: 'B' } });
    provider.revision = 'r2';

    await expect(service.commitProposal(proposal.proposalId)).rejects.toThrow('sync_conflict');
    expect(provider.updateEvent).not.toHaveBeenCalled();
  });

  it('commits an update when the provider revision is unchanged, verifying via getEvent afterwards', async () => {
    await repository.put({ eventId: 'e1', providerId: 'google', calendarId: 'primary', title: 'A', startAt: '2026-07-20T09:00:00.000Z', endAt: '2026-07-20T10:00:00.000Z', allDay: false, attendees: [], revision: 'r1' });
    const provider = fakeProvider();
    // getEvent's pre-write check must see the SAME revision the proposal baselined on (r1); only the
    // post-write getEvent call (after updateEvent bumps provider.revision to r2) should see r2.
    provider.getEvent = vi.fn(async (eventId) => Object.freeze({
      eventId, providerId: 'google', calendarId: 'primary', title: provider.revision === 'r1' ? 'A' : 'B',
      startAt: '2026-07-20T09:00:00.000Z', endAt: '2026-07-20T10:00:00.000Z', allDay: false, attendees: [], revision: provider.revision,
    }));
    provider.updateEvent = vi.fn(async () => { provider.revision = 'r2'; return { eventId: 'e1', revision: 'r2' }; });
    const service = buildService({ hub: fakeHub(provider) });

    const proposal = await service.proposeUpdate({ eventId: 'e1', patch: { title: 'B' } });
    const committed = await service.commitProposal(proposal.proposalId);
    expect(committed.title).toBe('B');
    expect(await repository.get('e1')).toMatchObject({ title: 'B', revision: 'r2' });
  });

  it('throws action_unverified when getEvent does not reflect the patched fields after commit', async () => {
    await repository.put({ eventId: 'e1', providerId: 'google', calendarId: 'primary', title: 'A', startAt: '2026-07-20T09:00:00.000Z', endAt: '2026-07-20T10:00:00.000Z', allDay: false, attendees: [], revision: 'r1' });
    const provider = fakeProvider();
    provider.getEvent = vi.fn(async (eventId) => Object.freeze({
      eventId, providerId: 'google', calendarId: 'primary', title: 'STILL-A',
      startAt: '2026-07-20T09:00:00.000Z', endAt: '2026-07-20T10:00:00.000Z', allDay: false, attendees: [], revision: 'r1',
    }));
    provider.updateEvent = vi.fn(async () => ({ eventId: 'e1', revision: 'r1' }));
    const service = buildService({ hub: fakeHub(provider) });
    const proposal = await service.proposeUpdate({ eventId: 'e1', patch: { title: 'B' } });
    await expect(service.commitProposal(proposal.proposalId)).rejects.toThrow('action_unverified');
  });

  it('rejects proposing an update for an unknown local event', async () => {
    await expect(buildService().proposeUpdate({ eventId: 'missing', patch: { title: 'B' } })).rejects.toThrow('calendar_event_not_found');
  });
});

describe('createCalendarService: cancel', () => {
  it('cancels an event through the provider and removes it locally after confirmation', async () => {
    await repository.put({ eventId: 'e1', providerId: 'google', calendarId: 'primary', title: 'A', startAt: '2026-07-20T09:00:00.000Z', endAt: '2026-07-20T10:00:00.000Z', allDay: false, attendees: [], revision: 'r1' });
    const provider = fakeProvider();
    const service = buildService({ hub: fakeHub(provider) });
    await service.cancel('e1');
    expect(provider.cancelEvent).toHaveBeenCalledWith('e1');
    expect(await repository.get('e1')).toBeNull();
  });

  it('rejects cancelling without local confirmation', async () => {
    await repository.put({ eventId: 'e1', providerId: 'google', calendarId: 'primary', title: 'A', startAt: '2026-07-20T09:00:00.000Z', endAt: '2026-07-20T10:00:00.000Z', allDay: false, attendees: [], revision: 'r1' });
    const confirmationService = { confirm: vi.fn(async () => false) };
    const provider = fakeProvider();
    const service = buildService({ hub: fakeHub(provider), confirmationService });
    await expect(service.cancel('e1')).rejects.toThrow('confirmation_refused');
    expect(provider.cancelEvent).not.toHaveBeenCalled();
  });
});
