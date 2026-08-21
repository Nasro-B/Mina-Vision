import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import BetterSqlite3 from 'better-sqlite3';

// Ledger local des communications (SPEC-MINA-COMMS-001 §4, §15, Phase 4). Deux tables :
//   communication_events   — métadonnées NON sensibles + état, direction, acteur, timestamps,
//                            identifiants de corrélation, digest de contact (jamais le numéro clair) ;
//   communication_payloads — numéro / texte / synthèse / champs structurés, CHIFFRÉS AES-256-GCM
//                            via le seal injecté (clé dédiée dérivée du coffre, jamais la clé maître).
//   communication_tasks    — mapping vers Google Tasks (tasklistId/providerTaskId/etag).
// Porte Phase 4 : « aucun événement accepté perdu ou dupliqué » → clé primaire = dedupeKey (un même
// SMS vu en USB et en Wi-Fi = une seule ligne, §16), écriture WAL durable, insertion atomique
// event+payload. Fail-closed : sans clé, un payload sensible est REFUSÉ, jamais écrit en clair.
// Module de STOCKAGE : il n'exécute aucune action, n'expose aucun outil PC (§16). Non câblé au runtime.

const PAYLOAD_TYPE = 'communication_payload';
const SENSITIVE_FIELDS = ['numberE164', 'body', 'synthesis', 'fields'];

function contactDigest(numberE164) {
  if (typeof numberE164 !== 'string' || !numberE164) return null;
  return createHash('sha256').update(numberE164).digest('hex');
}

function hasSensitivePayload(payload) {
  return SENSITIVE_FIELDS.some((field) => payload?.[field] !== undefined && payload?.[field] !== null && payload?.[field] !== '');
}

function rowToEvent(row) {
  if (!row) return null;
  return Object.freeze({
    dedupeKey: row.dedupe_key,
    kind: row.kind,
    deviceId: row.device_id,
    subscriptionId: row.subscription_id,
    direction: row.direction,
    actor: row.actor,
    state: row.state,
    eventId: row.event_id,
    messageId: row.message_id,
    callId: row.call_id,
    contactDigest: row.contact_digest,
    occurredAtMs: row.occurred_at_ms,
    durationMs: row.duration_ms,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export function createCommunicationLedger({
  filename, Database = BetterSqlite3, nativeBinding, seal = null, open = null, now = () => Date.now(),
} = {}) {
  if (!filename) throw new TypeError('communication_ledger_filename_required');
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
  // nativeBinding REQUIS sous Electron (ABI 148) ; en test Node il reste undefined (binding par défaut).
  const db = new Database(filename, nativeBinding ? { nativeBinding } : undefined);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS communication_events (
      dedupe_key TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      device_id TEXT NOT NULL,
      subscription_id TEXT,
      direction TEXT,
      actor TEXT,
      state TEXT,
      event_id TEXT,
      message_id TEXT,
      call_id TEXT,
      contact_digest TEXT,
      occurred_at_ms INTEGER NOT NULL DEFAULT 0,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS communication_payloads (
      dedupe_key TEXT PRIMARY KEY,
      payload_cipher TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS communication_tasks (
      dedupe_key TEXT PRIMARY KEY,
      tasklist_id TEXT,
      provider_task_id TEXT,
      etag TEXT,
      sync_state TEXT,
      updated_at INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS call_sessions (
      call_id TEXT PRIMARY KEY,
      device_id TEXT NOT NULL,
      dedupe_key TEXT,
      state TEXT NOT NULL,
      consent TEXT,
      media TEXT,
      error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_comm_events_occurred ON communication_events(occurred_at_ms);
    CREATE INDEX IF NOT EXISTS idx_comm_events_created ON communication_events(created_at);
    CREATE INDEX IF NOT EXISTS idx_call_sessions_created ON call_sessions(created_at);
  `);

  const selectEvent = db.prepare('SELECT * FROM communication_events WHERE dedupe_key = ?');
  const selectPayload = db.prepare('SELECT payload_cipher FROM communication_payloads WHERE dedupe_key = ?');
  const selectTask = db.prepare('SELECT * FROM communication_tasks WHERE dedupe_key = ?');
  const countEvents = db.prepare('SELECT COUNT(*) AS n FROM communication_events');
  const insertEvent = db.prepare(`
    INSERT INTO communication_events
      (dedupe_key, kind, device_id, subscription_id, direction, actor, state, event_id,
       message_id, call_id, contact_digest, occurred_at_ms, duration_ms, created_at, updated_at)
    VALUES (@dedupe_key, @kind, @device_id, @subscription_id, @direction, @actor, @state, @event_id,
       @message_id, @call_id, @contact_digest, @occurred_at_ms, @duration_ms, @created_at, @updated_at)
  `);
  const insertPayload = db.prepare(`
    INSERT INTO communication_payloads (dedupe_key, payload_cipher, updated_at) VALUES (?, ?, ?)
  `);
  const updateState = db.prepare('UPDATE communication_events SET state = ?, updated_at = ? WHERE dedupe_key = ?');
  const upsertTask = db.prepare(`
    INSERT INTO communication_tasks (dedupe_key, tasklist_id, provider_task_id, etag, sync_state, updated_at)
    VALUES (@dedupe_key, @tasklist_id, @provider_task_id, @etag, @sync_state, @updated_at)
    ON CONFLICT(dedupe_key) DO UPDATE SET
      tasklist_id = excluded.tasklist_id, provider_task_id = excluded.provider_task_id,
      etag = excluded.etag, sync_state = excluded.sync_state, updated_at = excluded.updated_at
  `);
  // Rétention basée sur created_at (temps d'INGESTION) : fenêtre prévisible de 90 jours, immunisée
  // contre un timestamp d'événement erroné envoyé par un téléphone (§15.1).
  const deleteExpiredEvents = db.prepare('DELETE FROM communication_events WHERE created_at < ?');
  const deleteOrphanPayloads = db.prepare(
    'DELETE FROM communication_payloads WHERE dedupe_key NOT IN (SELECT dedupe_key FROM communication_events)',
  );
  const deleteOrphanTasks = db.prepare(
    'DELETE FROM communication_tasks WHERE dedupe_key NOT IN (SELECT dedupe_key FROM communication_events)',
  );
  const selectCallSession = db.prepare('SELECT * FROM call_sessions WHERE call_id = ?');
  const insertCallSession = db.prepare(`
    INSERT INTO call_sessions (call_id, device_id, dedupe_key, state, consent, media, error, created_at, updated_at)
    VALUES (@call_id, @device_id, @dedupe_key, @state, @consent, @media, @error, @created_at, @updated_at)
  `);
  const deleteExpiredCallSessions = db.prepare('DELETE FROM call_sessions WHERE created_at < ?');

  function rowToCallSession(row) {
    if (!row) return null;
    return Object.freeze({
      callId: row.call_id,
      deviceId: row.device_id,
      dedupeKey: row.dedupe_key,
      state: row.state,
      consent: row.consent,
      media: row.media, // libellé d'endpoint HFP, JAMAIS de l'audio (§15.1)
      error: row.error,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }

  const insertTxn = db.transaction((eventRow, cipher) => {
    insertEvent.run(eventRow);
    if (cipher !== null) insertPayload.run(eventRow.dedupe_key, cipher, eventRow.updated_at);
  });

  function get(dedupeKey) {
    return rowToEvent(selectEvent.get(dedupeKey));
  }

  return Object.freeze({
    // Idempotent par dedupeKey : une redélivrance (autre transport, reprise après crash) NE crée
    // jamais de doublon — l'événement existant est renvoyé tel quel (deduped:true).
    record(event, payload = {}) {
      if (!event || typeof event.dedupeKey !== 'string' || !event.dedupeKey
        || typeof event.deviceId !== 'string' || !event.deviceId || typeof event.kind !== 'string') {
        throw new Error('communication_ledger_event_invalid');
      }
      const existing = selectEvent.get(event.dedupeKey);
      if (existing) return Object.freeze({ deduped: true, event: rowToEvent(existing) });

      // Fail-closed AVANT toute écriture : un payload sensible sans clé n'est jamais persisté.
      let cipher = null;
      if (hasSensitivePayload(payload)) {
        if (typeof seal !== 'function') throw new Error('communication_ledger_locked');
        const sealed = seal(JSON.stringify({
          numberE164: payload.numberE164 ?? null,
          body: typeof payload.body === 'string' ? payload.body : null,
          synthesis: payload.synthesis ?? null,
          fields: payload.fields ?? null,
        }), { type: PAYLOAD_TYPE, id: event.dedupeKey });
        cipher = JSON.stringify(sealed);
      }

      const at = now();
      const eventRow = {
        dedupe_key: event.dedupeKey,
        kind: event.kind,
        device_id: event.deviceId,
        subscription_id: event.subscriptionId ?? null,
        direction: event.direction ?? null,
        actor: event.actor ?? null,
        state: event.state ?? event.deliveryState ?? 'prepared',
        event_id: event.eventId ?? null,
        message_id: event.messageId ?? null,
        call_id: event.callId ?? null,
        contact_digest: contactDigest(payload.numberE164 ?? event.senderE164 ?? event.numberE164),
        occurred_at_ms: Number.isFinite(event.receivedAtMs) && event.receivedAtMs > 0
          ? event.receivedAtMs
          : (Number.isFinite(event.sentAtMs) ? event.sentAtMs : (Number.isFinite(event.atMs) ? event.atMs : at)),
        duration_ms: Number.isFinite(event.durationMs) ? event.durationMs : 0,
        created_at: at,
        updated_at: at,
      };
      insertTxn(eventRow, cipher);
      return Object.freeze({ deduped: false, event: rowToEvent(selectEvent.get(event.dedupeKey)) });
    },

    get,

    getPayload(dedupeKey) {
      const row = selectPayload.get(dedupeKey);
      if (!row) return null;
      if (typeof open !== 'function') throw new Error('communication_ledger_locked');
      const plaintext = open(JSON.parse(row.payload_cipher), { type: PAYLOAD_TYPE, id: dedupeKey });
      return Object.freeze(JSON.parse(Buffer.from(plaintext).toString('utf8')));
    },

    setState(dedupeKey, state) {
      if (typeof state !== 'string' || !state) throw new TypeError('communication_ledger_state_invalid');
      const info = updateState.run(state, now(), dedupeKey);
      if (info.changes === 0) throw new Error('communication_ledger_unknown_event');
      return get(dedupeKey);
    },

    attachTask(dedupeKey, { tasklistId = null, providerTaskId = null, etag = null, syncState = 'pending' } = {}) {
      if (!selectEvent.get(dedupeKey)) throw new Error('communication_ledger_unknown_event');
      upsertTask.run({
        dedupe_key: dedupeKey, tasklist_id: tasklistId, provider_task_id: providerTaskId,
        etag, sync_state: syncState, updated_at: now(),
      });
      return this.getTask(dedupeKey);
    },

    getTask(dedupeKey) {
      const row = selectTask.get(dedupeKey);
      if (!row) return null;
      return Object.freeze({
        dedupeKey: row.dedupe_key,
        tasklistId: row.tasklist_id,
        providerTaskId: row.provider_task_id,
        etag: row.etag,
        syncState: row.sync_state,
        updatedAt: row.updated_at,
      });
    },

    // §15.1 : synthèse confirmée et événements = 90 jours par défaut. La suppression cascade aux
    // payloads chiffrés et aux mappings de tâche orphelins (mais un mapping vivant garde son event).
    purgeExpired({ retentionDays = 90 } = {}) {
      const cutoff = now() - retentionDays * 86_400_000;
      const purge = db.transaction(() => {
        const removed = deleteExpiredEvents.run(cutoff).changes;
        deleteOrphanPayloads.run();
        deleteOrphanTasks.run();
        deleteExpiredCallSessions.run(cutoff);
        return removed;
      });
      return { removed: purge() };
    },

    // Session d'appel (§15) : état de conversation, consentement, erreurs, média utilisé — jamais
    // d'audio. Ouverture idempotente par callId : une reprise ne réinitialise pas une session vivante.
    openCallSession({ callId, deviceId, dedupeKey = null, state = 'detected' } = {}) {
      if (typeof callId !== 'string' || !callId || typeof deviceId !== 'string' || !deviceId) {
        throw new Error('call_session_ids_required');
      }
      const existing = selectCallSession.get(callId);
      if (existing) return rowToCallSession(existing);
      const at = now();
      insertCallSession.run({
        call_id: callId, device_id: deviceId, dedupe_key: dedupeKey, state,
        consent: null, media: null, error: null, created_at: at, updated_at: at,
      });
      return rowToCallSession(selectCallSession.get(callId));
    },

    updateCallSession(callId, patch = {}) {
      const current = selectCallSession.get(callId);
      if (!current) throw new Error('call_session_unknown');
      const next = {
        state: patch.state ?? current.state,
        consent: patch.consent ?? current.consent,
        media: patch.media ?? current.media,
        error: patch.error ?? current.error,
        updated_at: now(),
      };
      db.prepare('UPDATE call_sessions SET state = ?, consent = ?, media = ?, error = ?, updated_at = ? WHERE call_id = ?')
        .run(next.state, next.consent, next.media, next.error, next.updated_at, callId);
      return rowToCallSession(selectCallSession.get(callId));
    },

    getCallSession(callId) { return rowToCallSession(selectCallSession.get(callId)); },

    count: () => countEvents.get().n,
    close: () => db.close(),
  });
}
