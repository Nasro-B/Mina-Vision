import { describe, expect, it, vi } from 'vitest';
import { createBackupService } from '../src/backup/backup-service.mjs';
import { createRestoreService } from '../src/backup/restore-service.mjs';

const SECRET = 'FIREBASE_PLAINTEXT_SECRET_92d4';

function createRemote({ failPutAt = Infinity } = {}) {
  const objects = new Map();
  let puts = 0;
  return {
    putObject: vi.fn(async (key, bytes) => {
      puts += 1;
      if (puts === failPutAt) throw new Error('simulated_cut');
      objects.set(key, Buffer.from(bytes));
    }),
    getObject: vi.fn(async (key) => objects.get(key) ?? null),
    hasObject: vi.fn(async (key) => objects.has(key)),
    deleteObject: vi.fn(async (key) => { objects.delete(key); }),
    listObjects: vi.fn(async (prefix) => [...objects.keys()].filter((key) => key.startsWith(prefix))),
    inspect: () => objects,
    disableCut: () => { failPutAt = Infinity; },
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

function services(remote, key = Buffer.alloc(32, 111)) {
  return {
    backup: createBackupService({ remote, backupKey: key, now: () => 1_700_000_000_000 }),
    restore: createRestoreService({ remote, backupKey: key }),
  };
}

describe('encrypted backup and atomic restore', () => {
  it('uploads only ciphertext, signs the manifest and deduplicates a repeated snapshot', async () => {
    const remote = createRemote();
    const { backup } = services(remote);
    const input = {
      snapshotId: 'snapshot-1',
      records: [{ id: 'event-1', type: 'memory_event', payload: { content: SECRET } }],
      tombstones: [],
    };

    expect(await backup.backup(input)).toEqual(expect.objectContaining({ uploaded: 1, deduplicated: 0 }));
    expect(await backup.backup(input)).toEqual(expect.objectContaining({ uploaded: 0, deduplicated: 1 }));
    for (const bytes of remote.inspect().values()) expect(bytes.includes(Buffer.from(SECRET))).toBe(false);
  });

  it('resumes after a cut without uploading an existing blob twice', async () => {
    const remote = createRemote({ failPutAt: 2 });
    const { backup } = services(remote);
    const input = {
      snapshotId: 'resume',
      records: [
        { id: 'a', type: 'memory_event', payload: { content: 'A' } },
        { id: 'b', type: 'memory_event', payload: { content: 'B' } },
      ],
      tombstones: [],
    };

    await expect(backup.backup(input)).rejects.toThrow('simulated_cut');
    remote.disableCut();
    const result = await backup.backup(input);

    expect(result).toEqual(expect.objectContaining({ uploaded: 1, deduplicated: 1 }));
  });

  it('rejects a snapshot identifier conflict with different content', async () => {
    const remote = createRemote();
    const { backup } = services(remote);
    await backup.backup({
      snapshotId: 'same-id', records: [{ id: 'a', type: 'memory_event', payload: { value: 1 } }], tombstones: [],
    });
    await expect(backup.backup({
      snapshotId: 'same-id', records: [{ id: 'a', type: 'memory_event', payload: { value: 2 } }], tombstones: [],
    })).rejects.toThrow('backup_manifest_conflict');
  });

  it('restores atomically and a wrong recovered key leaves the target unchanged', async () => {
    const remote = createRemote();
    const { backup, restore } = services(remote);
    await backup.backup({
      snapshotId: 'restore', records: [{ id: 'event-1', type: 'memory_event', payload: { content: SECRET } }], tombstones: [],
    });
    const target = createTarget();
    await restore.restore({ snapshotId: 'restore', target });
    expect(target.committed[0].payload.content).toBe(SECRET);

    const wrong = createRestoreService({ remote, backupKey: Buffer.alloc(32, 112) });
    const untouched = createTarget();
    untouched.committed.push({ existing: true });
    await expect(wrong.restore({ snapshotId: 'restore', target: untouched }))
      .rejects.toThrow('backup_manifest_signature_invalid');
    expect(untouched.committed).toEqual([{ existing: true }]);
  });

  it('applies a newer encrypted tombstone before restoring an older snapshot', async () => {
    const remote = createRemote();
    const { backup, restore } = services(remote);
    await backup.backup({
      snapshotId: 'old', records: [{ id: 'event-old', type: 'memory_event', payload: { content: SECRET } }], tombstones: [],
    });
    await backup.publishTombstone({ id: 'tomb-1', target: 'event:event-old', createdAt: 2_000 });
    const target = createTarget();

    await restore.restore({ snapshotId: 'old', target });

    expect(target.committed).toEqual([]);
  });

  it('restores when the remote adapter rejects a trailing slash namespace prefix', async () => {
    const remote = createRemote();
    const originalListObjects = remote.listObjects;
    remote.listObjects = vi.fn(async (prefix) => {
      if (prefix.endsWith('/')) throw new Error('firebase_object_key_invalid');
      return originalListObjects(prefix);
    });
    const { backup, restore } = services(remote);
    await backup.backup({
      snapshotId: 'valid-tombstone-prefix',
      records: [{ id: 'event-1', type: 'memory_event', payload: { content: SECRET } }],
      tombstones: [],
    });
    const target = createTarget();

    await expect(restore.restore({ snapshotId: 'valid-tombstone-prefix', target }))
      .resolves.toEqual({ restored: 1, forgotten: 0 });
    expect(target.committed[0].payload.content).toBe(SECRET);
  });
});
