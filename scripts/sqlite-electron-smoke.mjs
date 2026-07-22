import { access } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { nativeCacheCandidates } from './native-cache-paths.mjs';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function resolveBinding() {
  const roots = nativeCacheCandidates({ rootDir: ROOT_DIR });
  for (const root of roots) {
    const binding = path.join(root, `electron-v${process.versions.modules}`, 'better_sqlite3.node');
    try {
      await access(binding);
      return binding;
    } catch {
      // Try the next configured cache root.
    }
  }
  throw new Error(`Binding better-sqlite3 Electron ABI ${process.versions.modules} introuvable.`);
}

const nativeBinding = await resolveBinding();
const database = new Database(':memory:', { nativeBinding });
database.pragma('foreign_keys = ON');
database.exec('CREATE TABLE smoke (payload BLOB NOT NULL)');
database.prepare('INSERT INTO smoke (payload) VALUES (?)').run(Buffer.from([1, 2, 3]));
const row = database.prepare('SELECT payload FROM smoke').get();
if (!Buffer.from(row.payload).equals(Buffer.from([1, 2, 3]))) throw new Error('sqlite_blob_roundtrip_failed');
database.close();
console.log(JSON.stringify({ ok: true, electron: process.versions.electron, abi: process.versions.modules }));
