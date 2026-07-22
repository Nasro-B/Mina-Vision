import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openMemoryDatabase } from '../../src/memory/database.mjs';
import { createEventRepository } from '../../src/memory/event-repository.mjs';
import { createIdentityRepository } from '../../src/memory/identity-repository.mjs';
import { createTombstoneRepository } from '../../src/memory/tombstone-repository.mjs';
import { createIdentityGraph } from '../../src/memory/identity-graph.mjs';
import { createMemoryService } from '../../src/memory/memory-service.mjs';
import { createForgetService } from '../../src/memory/forget-service.mjs';
import { createBackupService } from '../../src/backup/backup-service.mjs';
import { createRestoreService } from '../../src/backup/restore-service.mjs';

let db;
let directory;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'mina-backup-restore-'));
  db = openMemoryDatabase({ filename: join(directory, 'memory.sqlite'), securePermissions: () => {} });
});

afterEach(async () => {
  if (db?.open) db.close();
  await rm(directory, { recursive: true, force: true });
});

function createRemote() {
  const objects = new Map();
  return {
    objects,
    putObject: vi.fn(async (key, bytes) => objects.set(key, Buffer.from(bytes))),
    getObject: vi.fn(async (key) => objects.get(key) ?? null),
    hasObject: vi.fn(async (key) => objects.has(key)),
    deleteObject: vi.fn(async (key) => { objects.delete(key); }),
    listObjects: vi.fn(async (prefix) => [...objects.keys()].filter((key) => key.startsWith(prefix))),
  };
}

function createTarget() {
  const committed = [];
  return {
    committed,
    beginTemporary: vi.fn(async () => {
      const staged = [];
      return {
        write: async (record) => staged.push(structuredClone(record)),
        commit: async () => committed.splice(0, committed.length, ...staged),
        rollback: vi.fn(async () => { staged.splice(0); }),
      };
    }),
  };
}

function buildWorld() {
  const encryptionKey = Buffer.alloc(32, 41);
  const indexKey = Buffer.alloc(32, 53);
  const eventRepository = createEventRepository({ db, encryptionKey, indexKey });
  const identityRepository = createIdentityRepository({ db, encryptionKey, indexKey });
  const tombstoneRepository = createTombstoneRepository({ db, encryptionKey, indexKey });
  const identityGraph = createIdentityGraph({ identityRepository, idGenerator: (() => { let n = 0; return () => `link-${++n}`; })() });
  const memoryService = createMemoryService({
    eventRepository, identityGraph,
    idGenerator: (() => { let n = 0; return () => `event-${++n}`; })(),
    now: () => 1_700_000_000_000,
  });
  const forgetService = createForgetService({
    db, eventRepository, tombstoneRepository, encryptionKey, indexKey,
    now: () => 1_700_000_060_000, idGenerator: (() => { let n = 0; return () => `tombstone-${++n}`; })(),
  });
  const backupKey = Buffer.alloc(32, 111);
  const remote = createRemote();
  const backup = createBackupService({ remote, backupKey, now: () => 1_700_000_000_000 });
  const restore = createRestoreService({ remote, backupKey });
  return { identityGraph, memoryService, forgetService, backup, restore, remote };
}

describe('v2 integration: a locally-confirmed forget survives a restore from an older backup snapshot', () => {
  it('the forgotten memory never comes back; an untouched sibling memory restores normally', async () => {
    const { identityGraph, memoryService, forgetService, backup, restore } = buildWorld();
    identityGraph.registerOwner({ id: 'owner-1', displayName: 'Nasro' });
    identityGraph.link({ ownerId: 'owner-1', kind: 'phone', value: '+33600000000', proof: { verified: true, method: 'local_pairing' } });

    // Two real, memory-service-produced events — realistic encrypted-at-rest content, not a literal fixture.
    const secretEvent = memoryService.remember({
      channel: 'sms', kind: 'phone', value: '+33600000000', content: 'Mon code de virement est 778241', classification: 'sensitive',
    });
    const keptEvent = memoryService.remember({
      channel: 'sms', kind: 'phone', value: '+33600000000', content: 'Rendez-vous dentiste jeudi', classification: 'normal',
    });

    // Snapshot both while they still exist (the "older backup").
    await backup.backup({
      snapshotId: 'snapshot-old',
      records: [
        { id: secretEvent.id, type: 'memory_event', payload: secretEvent },
        { id: keptEvent.id, type: 'memory_event', payload: keptEvent },
      ],
      tombstones: [],
    });

    // A real local forget, requiring the explicit confirmedLocally:true gate — never automatic.
    const proposal = forgetService.proposeForget({ criteria: { eventId: secretEvent.id }, requester: 'local' });
    const forgotten = forgetService.confirmForget({ proposalId: proposal.id, confirmedLocally: true });
    expect(forgotten.deleted).toBe(1);
    expect(memoryService.recall({ kind: 'phone', value: '+33600000000', query: 'virement' })).toEqual([]);

    // The forget event syncs to the remote backup as a tombstone (simulates outbox drain to Firebase).
    await backup.publishTombstone({ id: 'tomb-1', target: `event:${secretEvent.id}`, createdAt: 1_700_000_060_000 });

    // Restoring the OLDER snapshot into a fresh target must still respect the newer tombstone.
    const target = createTarget();
    await restore.restore({ snapshotId: 'snapshot-old', target });

    const restoredIds = target.committed.map((record) => record.id);
    expect(restoredIds).toContain(keptEvent.id);
    expect(restoredIds).not.toContain(secretEvent.id);
  });
});
