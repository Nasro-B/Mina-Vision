import { blindHash, canonicalJson, openRecord, sealRecord } from './record-codec.mjs';

function requireEvent(event) {
  if (!event?.id || !Number.isInteger(event.version) || !Number.isFinite(event.createdAt) || !event.type) {
    throw new TypeError('invalid_memory_event');
  }
}

export function createEventRepository({ db, encryptionKey, indexKey } = {}) {
  if (!db || Buffer.from(encryptionKey ?? []).length !== 32 || Buffer.from(indexKey ?? []).length !== 32) {
    throw new TypeError('event_repository_configuration_required');
  }
  const insertEvent = db.prepare(`
    INSERT INTO memory_events (
      event_id, version, created_at, event_type_hash, identity_hash, channel_hash,
      source_hash, ciphertext, content_size, sync_state
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
  `);
  const insertChunk = db.prepare(`
    INSERT INTO memory_chunks (
      chunk_id, event_id, ordinal, created_at, ciphertext, content_size
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);
  const selectEvent = db.prepare('SELECT ciphertext FROM memory_events WHERE event_id = ?');
  const selectChunks = db.prepare('SELECT chunk_id, ordinal, ciphertext FROM memory_chunks WHERE event_id = ? ORDER BY ordinal');
  const selectAll = db.prepare('SELECT event_id, ciphertext FROM memory_events ORDER BY created_at, event_id');
  const deleteEvent = db.prepare('DELETE FROM memory_events WHERE event_id = ?');
  const selectByIdentity = db.prepare(`
    SELECT event_id, ciphertext
    FROM memory_events
    WHERE identity_hash = ?
    ORDER BY created_at DESC, event_id DESC
  `);

  const writeTransaction = db.transaction(({ event, chunks = [] }) => {
    requireEvent(event);
    const serializedEvent = canonicalJson(event);
    insertEvent.run(
      event.id,
      event.version,
      event.createdAt,
      blindHash(indexKey, 'event_type', event.type),
      blindHash(indexKey, 'identity', event.identity),
      blindHash(indexKey, 'channel', event.channel),
      blindHash(indexKey, 'source', event.source),
      sealRecord({ key: encryptionKey, type: 'memory_event', id: event.id, value: event }),
      Buffer.byteLength(serializedEvent),
    );
    for (const chunk of chunks) {
      if (!chunk?.id || !Number.isInteger(chunk.ordinal) || chunk.ordinal < 0) {
        throw new TypeError('invalid_memory_chunk');
      }
      insertChunk.run(
        chunk.id,
        event.id,
        chunk.ordinal,
        event.createdAt,
        sealRecord({ key: encryptionKey, type: 'memory_chunk', id: chunk.id, value: chunk }),
        Buffer.byteLength(canonicalJson(chunk)),
      );
    }
  });

  function write(value) {
    writeTransaction(value);
  }

  function read(eventId) {
    const row = selectEvent.get(eventId);
    if (!row) return null;
    return {
      event: openRecord({ key: encryptionKey, type: 'memory_event', id: eventId, ciphertext: row.ciphertext }),
      chunks: selectChunks.all(eventId).map((chunk) => openRecord({
        key: encryptionKey,
        type: 'memory_chunk',
        id: chunk.chunk_id,
        ciphertext: chunk.ciphertext,
      })),
    };
  }

  function listByIdentity(identity) {
    return selectByIdentity.all(blindHash(indexKey, 'identity', identity)).map((row) => openRecord({
      key: encryptionKey,
      type: 'memory_event',
      id: row.event_id,
      ciphertext: row.ciphertext,
    }));
  }

  function listAll() {
    return selectAll.all().map((row) => openRecord({
      key: encryptionKey,
      type: 'memory_event',
      id: row.event_id,
      ciphertext: row.ciphertext,
    }));
  }

  function deleteByIds(eventIds) {
    let deleted = 0;
    for (const eventId of eventIds) deleted += deleteEvent.run(eventId).changes;
    return deleted;
  }

  return Object.freeze({ write, read, listByIdentity, listAll, deleteByIds });
}
