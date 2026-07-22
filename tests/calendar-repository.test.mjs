import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyPersonalCalendarMigrations, createCalendarRepository } from '../src/personal/calendar-repository.mjs';

let db;
let directory;
let repository;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'mina-personal-calendar-'));
  db = new Database(join(directory, 'personal-calendar.sqlite'));
  applyPersonalCalendarMigrations(db);
  repository = createCalendarRepository({ db, clock: () => 1_700_000_000_000 });
});

afterEach(async () => {
  if (db?.open) db.close();
  await rm(directory, { recursive: true, force: true });
});

function event(overrides = {}) {
  return {
    eventId: 'e1', providerId: 'google', calendarId: 'primary', title: 'RDV', description: '', location: '',
    startAt: '2026-07-20T09:00:00.000Z', endAt: '2026-07-20T10:00:00.000Z', allDay: false, attendees: [], revision: 'r1',
    ...overrides,
  };
}

describe('applyPersonalCalendarMigrations', () => {
  it('is idempotent', () => {
    expect(() => applyPersonalCalendarMigrations(db)).not.toThrow();
  });
});

describe('createCalendarRepository: put/get', () => {
  it('persists and retrieves an event, round-tripping startAt/endAt/attendees', async () => {
    await repository.put(event({ attendees: [{ email: 'a@example.com', responseStatus: 'accepted' }] }));
    const stored = await repository.get('e1');
    expect(stored).toMatchObject({ eventId: 'e1', title: 'RDV', startAt: '2026-07-20T09:00:00.000Z', revision: 'r1' });
    expect(stored.attendees).toEqual([{ email: 'a@example.com', responseStatus: 'accepted' }]);
  });

  it('upserts on the same eventId (last write wins)', async () => {
    await repository.put(event({ title: 'A', revision: 'r1' }));
    await repository.put(event({ title: 'B', revision: 'r2' }));
    expect((await repository.get('e1')).title).toBe('B');
  });

  it('returns null for an unknown eventId', async () => {
    expect(await repository.get('missing')).toBeNull();
  });
});

describe('createCalendarRepository: delete', () => {
  it('removes an event by id', async () => {
    await repository.put(event());
    await repository.delete('e1');
    expect(await repository.get('e1')).toBeNull();
  });
});

describe('createCalendarRepository: list', () => {
  it('lists events within a from/to window, ordered by startAt', async () => {
    await repository.put(event({ eventId: 'e2', startAt: '2026-07-22T09:00:00.000Z', endAt: '2026-07-22T10:00:00.000Z' }));
    await repository.put(event({ eventId: 'e1', startAt: '2026-07-20T09:00:00.000Z', endAt: '2026-07-20T10:00:00.000Z' }));
    const results = await repository.list({ from: '2026-07-19T00:00:00.000Z', to: '2026-07-23T00:00:00.000Z' });
    expect(results.map((entry) => entry.eventId)).toEqual(['e1', 'e2']);
  });

  it('excludes events outside the window', async () => {
    await repository.put(event({ eventId: 'e-out', startAt: '2026-08-01T09:00:00.000Z', endAt: '2026-08-01T10:00:00.000Z' }));
    const results = await repository.list({ from: '2026-07-19T00:00:00.000Z', to: '2026-07-23T00:00:00.000Z' });
    expect(results).toEqual([]);
  });

  it('filters by providerId when requested', async () => {
    await repository.put(event({ eventId: 'e-g', providerId: 'google' }));
    await repository.put(event({ eventId: 'e-m', providerId: 'microsoft' }));
    const results = await repository.list({ from: '2026-01-01T00:00:00.000Z', to: '2027-01-01T00:00:00.000Z', providerId: 'microsoft' });
    expect(results.map((entry) => entry.eventId)).toEqual(['e-m']);
  });
});

describe('createCalendarRepository: sync cursor', () => {
  it('returns null cursor when never set', async () => {
    expect(await repository.getCursor('google')).toBeNull();
  });

  it('persists and retrieves a cursor per provider', async () => {
    await repository.setCursor('google', 'sync-token-1');
    expect(await repository.getCursor('google')).toBe('sync-token-1');
    expect(await repository.getCursor('microsoft')).toBeNull();
  });

  it('overwrites the cursor on repeated set', async () => {
    await repository.setCursor('google', 'sync-token-1');
    await repository.setCursor('google', 'sync-token-2');
    expect(await repository.getCursor('google')).toBe('sync-token-2');
  });
});
