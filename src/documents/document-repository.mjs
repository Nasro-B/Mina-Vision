import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import BetterSqlite3 from 'better-sqlite3';

// Generic put/get/list JSON record store, shared by every document/printing sub-module that only
// needs simple key-value persistence (printer approvals, document evidence, classification
// proposals) — see src/memory/database.mjs for the richer, migration-driven store used by memory.
export function createJsonRepository({ filename, table, Database = BetterSqlite3, nativeBinding } = {}) {
  if (!filename) throw new TypeError('json_repository_filename_required');
  if (!/^[a-z][a-z0-9_]*$/u.test(table ?? '')) throw new TypeError('json_repository_table_invalid');
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
  // nativeBinding REQUIRED under Electron (ABI 148) — see message-delivery-ledger.mjs for why.
  const db = new Database(filename, nativeBinding ? { nativeBinding } : undefined);
  db.pragma('journal_mode = WAL');
  db.exec(`CREATE TABLE IF NOT EXISTS "${table}" (id TEXT PRIMARY KEY, record TEXT NOT NULL, updated_at INTEGER NOT NULL) STRICT`);

  const upsert = db.prepare(`INSERT INTO "${table}" (id, record, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET record = excluded.record, updated_at = excluded.updated_at`);
  const selectOne = db.prepare(`SELECT record FROM "${table}" WHERE id = ?`);
  const selectAll = db.prepare(`SELECT record FROM "${table}"`);

  return Object.freeze({
    async put(id, record) { upsert.run(String(id), JSON.stringify(record), Date.now()); },
    async get(id) {
      const row = selectOne.get(String(id));
      return row ? JSON.parse(row.record) : null;
    },
    async list() { return selectAll.all().map((row) => JSON.parse(row.record)); },
    close: () => db.close(),
  });
}
