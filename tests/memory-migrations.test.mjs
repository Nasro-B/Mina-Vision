import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyMigrations,
  openMemoryDatabase,
} from '../src/memory/database.mjs';

const cleanups = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function createDatabase() {
  const directory = await mkdtemp(join(tmpdir(), 'mina-memory-'));
  cleanups.push(directory);
  const filename = join(directory, 'memory.sqlite');
  const securePermissions = vi.fn();
  const db = openMemoryDatabase({ filename, securePermissions });
  return { db, filename, securePermissions };
}

describe('memory database migrations', () => {
  it('creates every required table on an empty database and is idempotent', async () => {
    const { db } = await createDatabase();
    const expected = [
      'identities',
      'identity_links',
      'memory_chunks',
      'memory_events',
      'outbox_backup',
      'schema_migrations',
      'sessions',
      'tombstones',
    ];

    const before = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({ name }) => name);
    applyMigrations(db);
    const after = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({ name }) => name);

    expect(before).toEqual(expected);
    expect(after).toEqual(expected);
    expect(db.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get().count).toBe(1);
    db.close();
  });

  it('rolls back all statements from a failed migration', async () => {
    const { db } = await createDatabase();

    expect(() => applyMigrations(db, [{
      version: 2,
      name: 'broken',
      sql: 'CREATE TABLE must_rollback (id TEXT); INSERT INTO missing_table VALUES (1);',
    }])).toThrow();

    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'must_rollback'").get()).toBeUndefined();
    expect(db.prepare('SELECT version FROM schema_migrations WHERE version = 2').get()).toBeUndefined();
    db.close();
  });

  it('enables foreign keys, WAL and a 5000 ms busy timeout, then secures the file', async () => {
    const { db, filename, securePermissions } = await createDatabase();

    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(db.pragma('busy_timeout', { simple: true })).toBe(5_000);
    expect(securePermissions).toHaveBeenCalledWith(filename);
    db.close();
    expect((await readFile(filename)).length).toBeGreaterThan(0);
  });
});
