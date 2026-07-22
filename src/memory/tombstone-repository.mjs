import { blindHash, openRecord, sealRecord } from './record-codec.mjs';

export function createTombstoneRepository({ db, encryptionKey, indexKey } = {}) {
  if (!db || Buffer.from(encryptionKey ?? []).length !== 32 || Buffer.from(indexKey ?? []).length !== 32) {
    throw new TypeError('tombstone_repository_configuration_required');
  }
  const insert = db.prepare(`
    INSERT INTO tombstones (tombstone_id, target_hash, ciphertext, created_at, sync_state)
    VALUES (?, ?, ?, ?, 0)
  `);
  const select = db.prepare('SELECT tombstone_id, ciphertext FROM tombstones WHERE target_hash = ?');

  function write(tombstone) {
    if (!tombstone?.id || !tombstone.target || !Number.isFinite(tombstone.createdAt)) {
      throw new TypeError('invalid_tombstone');
    }
    insert.run(
      tombstone.id,
      blindHash(indexKey, 'tombstone_target', tombstone.target),
      sealRecord({ key: encryptionKey, type: 'tombstone', id: tombstone.id, value: tombstone }),
      tombstone.createdAt,
    );
  }

  function findByTarget(target) {
    const row = select.get(blindHash(indexKey, 'tombstone_target', target));
    if (!row) return null;
    return openRecord({ key: encryptionKey, type: 'tombstone', id: row.tombstone_id, ciphertext: row.ciphertext });
  }

  function hasTarget(target) {
    return Boolean(select.get(blindHash(indexKey, 'tombstone_target', target)));
  }

  return Object.freeze({ write, findByTarget, hasTarget });
}
