import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';

let database;

afterEach(() => {
  database?.close();
  database = null;
});

describe('better-sqlite3 compatibility', () => {
  it('opens an in-memory database with foreign keys and round-trips a blob', () => {
    database = new Database(':memory:');
    database.pragma('foreign_keys = ON');
    database.exec('CREATE TABLE blobs (id INTEGER PRIMARY KEY, payload BLOB NOT NULL)');
    const payload = Buffer.from([0, 1, 2, 127, 128, 255]);

    database.prepare('INSERT INTO blobs (payload) VALUES (?)').run(payload);
    const row = database.prepare('SELECT payload FROM blobs WHERE id = 1').get();

    expect(database.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(Buffer.from(row.payload)).toEqual(payload);
  });
});
