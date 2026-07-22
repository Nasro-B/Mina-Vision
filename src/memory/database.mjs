import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import BetterSqlite3 from 'better-sqlite3';

const INITIAL_SQL = readFileSync(new URL('./schema/001-initial.sql', import.meta.url), 'utf8');
const INITIAL_MIGRATION = Object.freeze({ version: 1, name: 'initial', sql: INITIAL_SQL });

function migrationChecksum(migration) {
  return createHash('sha256').update(`${migration.version}\0${migration.name}\0${migration.sql}`).digest('hex');
}

export function secureSqlitePath(filename) {
  const paths = [filename, `${filename}-wal`, `${filename}-shm`].filter(existsSync);
  for (const path of paths) chmodSync(path, 0o600);
  if (process.platform !== 'win32') return;

  const account = [process.env.USERDOMAIN, process.env.USERNAME].filter(Boolean).join('\\');
  if (!account) throw new Error('windows_account_unavailable');
  for (const path of paths) {
    const result = spawnSync('icacls.exe', [path, '/inheritance:r', '/grant:r', `${account}:(F)`], {
      encoding: 'utf8',
      windowsHide: true,
    });
    if (result.status !== 0) throw new Error(`sqlite_acl_failed:${result.stderr || result.stdout}`);
  }
}

export function applyMigrations(db, migrations = [INITIAL_MIGRATION]) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    ) STRICT
  `);
  const current = db.prepare('SELECT name, checksum FROM schema_migrations WHERE version = ?');
  const applied = db.prepare(`
    INSERT INTO schema_migrations (version, name, checksum, applied_at)
    VALUES (?, ?, ?, ?)
  `);

  for (const migration of [...migrations].sort((a, b) => a.version - b.version)) {
    const checksum = migrationChecksum(migration);
    const existing = current.get(migration.version);
    if (existing) {
      if (existing.name !== migration.name || existing.checksum !== checksum) {
        throw new Error(`migration_checksum_mismatch:${migration.version}`);
      }
      continue;
    }
    db.transaction(() => {
      db.exec(migration.sql);
      applied.run(migration.version, migration.name, checksum, Date.now());
    })();
  }
}

export function openMemoryDatabase({
  filename,
  Database = BetterSqlite3,
  nativeBinding,
  securePermissions = secureSqlitePath,
} = {}) {
  if (!filename) throw new TypeError('memory_database_filename_required');
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
  const db = new Database(filename, nativeBinding ? { nativeBinding } : undefined);
  try {
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');
    db.pragma('journal_mode = WAL');
    applyMigrations(db);
    if (filename !== ':memory:') securePermissions(filename);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
