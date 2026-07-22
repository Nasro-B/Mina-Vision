import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import BetterSqlite3 from 'better-sqlite3';

// State machine: pending -> generating -> reply_ready -> sending -> sent -> acked, with
// retry_wait (transient failure, will retry) and dead_letter (gave up, must still ack the
// device so the pull loop drains) reachable from any in-flight state. Persisted to survive a
// process restart mid-delivery — that is the entire point of this ledger.
const VALID_STATES = new Set(['pending', 'generating', 'reply_ready', 'sending', 'sent', 'acked', 'retry_wait', 'dead_letter']);
const KEY_PART = /^[^:\s]+$/u;

export function deliveryKeyFor({ channel, deviceId, messageId } = {}) {
  for (const [name, value] of [['channel', channel], ['deviceId', deviceId], ['messageId', messageId]]) {
    if (typeof value !== 'string' || !KEY_PART.test(value)) throw new TypeError(`message_delivery_key_part_invalid:${name}`);
  }
  return `${channel}:${deviceId}:${messageId}`;
}

function rowToRecord(row) {
  if (!row) return null;
  return Object.freeze({
    deliveryKey: row.delivery_key,
    state: row.state,
    attempt: row.attempt,
    replyText: row.reply_text,
    providerMessageId: row.provider_message_id,
    lastError: row.last_error,
    nextRetryAt: row.next_retry_at,
    updatedAt: row.updated_at,
  });
}

export function createMessageDeliveryLedger({ filename, Database = BetterSqlite3, nativeBinding, now = () => Date.now() } = {}) {
  if (!filename) throw new TypeError('message_delivery_ledger_filename_required');
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
  // nativeBinding is REQUIRED under Electron (ABI 148); without it better-sqlite3 loads its default
  // Node-ABI-127 binding and the whole app crashes at boot. In Node-based tests it stays undefined
  // and the default binding is correct.
  const db = new Database(filename, nativeBinding ? { nativeBinding } : undefined);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS message_delivery (
      delivery_key TEXT PRIMARY KEY,
      state TEXT NOT NULL,
      attempt INTEGER NOT NULL DEFAULT 0,
      reply_text TEXT,
      provider_message_id TEXT,
      last_error TEXT,
      next_retry_at INTEGER,
      updated_at INTEGER NOT NULL
    ) STRICT
  `);

  const selectStmt = db.prepare('SELECT * FROM message_delivery WHERE delivery_key = ?');
  const insertStmt = db.prepare(`
    INSERT INTO message_delivery (delivery_key, state, attempt, updated_at) VALUES (?, 'pending', 0, ?)
  `);
  const updateStmt = db.prepare(`
    UPDATE message_delivery
    SET state = ?, attempt = ?, reply_text = ?, provider_message_id = ?, last_error = ?, next_retry_at = ?, updated_at = ?
    WHERE delivery_key = ?
  `);

  function get(deliveryKey) {
    return rowToRecord(selectStmt.get(deliveryKey));
  }

  function requireExisting(deliveryKey) {
    const existing = get(deliveryKey);
    if (!existing) throw new Error('message_delivery_unknown_key');
    return existing;
  }

  function persist(deliveryKey, patch) {
    const current = requireExisting(deliveryKey);
    const next = { ...current, ...patch, updatedAt: now() };
    updateStmt.run(
      next.state, next.attempt, next.replyText ?? null, next.providerMessageId ?? null,
      next.lastError ?? null, next.nextRetryAt ?? null, next.updatedAt, deliveryKey,
    );
    return get(deliveryKey);
  }

  return Object.freeze({
    // Idempotent claim: a brand-new key starts 'pending'; an existing key (redelivery after a
    // restart) is returned UNCHANGED so the caller never re-triggers work already in flight.
    claim(deliveryKey) {
      const existing = get(deliveryKey);
      if (existing) return existing;
      insertStmt.run(deliveryKey, now());
      return get(deliveryKey);
    },
    get,
    setState(deliveryKey, state, patch = {}) {
      if (!VALID_STATES.has(state)) throw new TypeError(`message_delivery_state_invalid:${state}`);
      const { attempt: _ignored, ...rest } = patch;
      return persist(deliveryKey, { ...rest, state });
    },
    scheduleRetry(deliveryKey, { lastError, nextRetryAt }) {
      const current = requireExisting(deliveryKey);
      return persist(deliveryKey, { state: 'retry_wait', attempt: current.attempt + 1, lastError, nextRetryAt });
    },
    markDeadLetter(deliveryKey, reason) {
      return persist(deliveryKey, { state: 'dead_letter', lastError: String(reason) });
    },
    close: () => db.close(),
  });
}
