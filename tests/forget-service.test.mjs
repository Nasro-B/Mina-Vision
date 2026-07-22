import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openMemoryDatabase } from '../src/memory/database.mjs';
import { createEventRepository } from '../src/memory/event-repository.mjs';
import { createTombstoneRepository } from '../src/memory/tombstone-repository.mjs';
import { createForgetService } from '../src/memory/forget-service.mjs';

let db;
let directory;
let events;
let tombstones;
let forget;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'mina-forget-'));
  db = openMemoryDatabase({ filename: join(directory, 'memory.sqlite'), securePermissions: () => {} });
  const encryptionKey = Buffer.alloc(32, 61);
  const indexKey = Buffer.alloc(32, 71);
  events = createEventRepository({ db, encryptionKey, indexKey });
  tombstones = createTombstoneRepository({ db, encryptionKey, indexKey });
  let id = 0;
  forget = createForgetService({
    db,
    eventRepository: events,
    tombstoneRepository: tombstones,
    encryptionKey,
    indexKey,
    idGenerator: () => `forget-${++id}`,
    now: () => 9_000,
  });
});

afterEach(async () => {
  if (db?.open) db.close();
  await rm(directory, { recursive: true, force: true });
});

function writeEvent({ id, content, identity = 'nasro', createdAt = 100, sourceEventIds }) {
  events.write({
    event: {
      id, version: 1, createdAt, type: sourceEventIds ? 'memory_summary' : 'memory',
      identity, channel: 'local', source: 'test', content, classification: 'normal',
      ...(sourceEventIds ? { sourceEventIds } : {}),
    },
    chunks: [{ id: `${id}:chunk`, ordinal: 0, content }],
  });
}

async function proposeAndConfirm(criteria, requester = 'local') {
  const proposal = forget.proposeForget({ criteria, requester });
  return forget.confirmForget({ proposalId: proposal.id, confirmedLocally: true });
}

describe('verifiable forgetting', () => {
  it.each([
    ['event', { eventId: 'event-a' }, ['event-a']],
    ['subject', { subject: 'dentiste mardi' }, ['event-a']],
    ['identity', { identity: 'other' }, ['event-b']],
    ['interval', { from: 190, to: 210 }, ['event-b']],
  ])('forgets by %s and cascades chunks', async (_label, criteria, expectedIds) => {
    writeEvent({ id: 'event-a', content: 'dentiste mardi à 14h', createdAt: 100 });
    writeEvent({ id: 'event-b', content: 'autre souvenir', identity: 'other', createdAt: 200 });

    const report = await proposeAndConfirm(criteria);

    expect(report).toEqual({ matched: expectedIds.length, deleted: expectedIds.length, backupPending: expectedIds.length, completedAt: 9_000 });
    for (const id of expectedIds) {
      expect(events.read(id)).toBeNull();
      expect(tombstones.hasTarget(`event:${id}`)).toBe(true);
    }
    expect(db.prepare('SELECT COUNT(*) AS count FROM memory_chunks').get().count).toBe(2 - expectedIds.length);
  });

  it('deletes derived projections that reference a forgotten source', async () => {
    writeEvent({ id: 'event-source', content: 'source privée' });
    writeEvent({ id: 'summary', content: 'projection', sourceEventIds: ['event-source'] });

    const report = await proposeAndConfirm({ eventId: 'event-source' });

    expect(report.deleted).toBe(2);
    expect(events.listAll()).toEqual([]);
    expect(tombstones.hasTarget('event:summary')).toBe(true);
  });

  it('turns a remote request into a proposal and never deletes before local confirmation', () => {
    writeEvent({ id: 'event-remote', content: 'à oublier' });

    const proposal = forget.proposeForget({ criteria: { eventId: 'event-remote' }, requester: 'sms' });

    expect(proposal.status).toBe('awaiting_local_confirmation');
    expect(events.read('event-remote')).not.toBeNull();
    expect(() => forget.confirmForget({ proposalId: proposal.id, confirmedLocally: false }))
      .toThrow('local_forget_confirmation_required');
    expect(events.read('event-remote')).not.toBeNull();
  });

  it('is idempotent and tombstones prevent restoration from an older backup', async () => {
    const backupEvent = {
      id: 'event-old', version: 1, createdAt: 100, type: 'memory', identity: 'nasro',
      channel: 'sms', source: 'backup', content: 'ancien secret', classification: 'secret',
    };
    writeEvent(backupEvent);
    await proposeAndConfirm({ eventId: 'event-old' });

    const second = await proposeAndConfirm({ eventId: 'event-old' });

    expect(second).toEqual({ matched: 0, deleted: 0, backupPending: 0, completedAt: 9_000 });
    expect(forget.filterRestorable([backupEvent])).toEqual([]);
    expect(db.prepare('SELECT COUNT(*) AS count FROM outbox_backup').get().count).toBe(1);
  });
});
