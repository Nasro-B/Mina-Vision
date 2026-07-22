import { createHash } from 'node:crypto';
import { canonicalJson, openRecord, sealRecord } from '../memory/record-codec.mjs';

const JOB_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,200}$/u;
const EVENT_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,200}$/u;
const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'budget_exceeded']);

export function applyJobHistoryMigration(db) {
  if (!db?.exec) throw new TypeError('sandbox_history_database_required');
  db.exec(`
    CREATE TABLE IF NOT EXISTS sandbox_jobs (
      job_id TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL,
      status TEXT NOT NULL,
      ciphertext BLOB NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS sandbox_job_events (
      job_id TEXT NOT NULL REFERENCES sandbox_jobs(job_id) ON DELETE CASCADE,
      event_id TEXT NOT NULL,
      ordinal INTEGER NOT NULL,
      event_digest TEXT NOT NULL,
      event_bytes INTEGER NOT NULL,
      ciphertext BLOB NOT NULL,
      PRIMARY KEY (job_id, event_id),
      UNIQUE (job_id, ordinal)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS sandbox_job_events_order_idx ON sandbox_job_events(job_id, ordinal);
  `);
}

function digest(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function validRecord(record) {
  if (!record || !JOB_ID.test(record.jobId ?? '') || !Number.isSafeInteger(record.requestedAt)
    || !record.request || typeof record.request !== 'object' || !Array.isArray(record.confirmations)
    || !record.digests || typeof record.digests !== 'object') throw new TypeError('sandbox_history_record_invalid');
  return record;
}

export function createJobHistory({ db, encryptionKey, maxEvents = 10_000, maxTotalBytes = 10 * 1024 * 1024 } = {}) {
  const key = Buffer.from(encryptionKey ?? []);
  if (!db?.prepare || key.length !== 32 || !Number.isSafeInteger(maxEvents) || maxEvents < 1
    || !Number.isSafeInteger(maxTotalBytes) || maxTotalBytes < 1) throw new TypeError('sandbox_history_dependencies_required');
  const findJob = db.prepare('SELECT * FROM sandbox_jobs WHERE job_id = ?');
  const findEvent = db.prepare('SELECT event_digest FROM sandbox_job_events WHERE job_id = ? AND event_id = ?');
  const listEvents = db.prepare('SELECT event_id, ciphertext FROM sandbox_job_events WHERE job_id = ? ORDER BY ordinal');
  const stats = db.prepare('SELECT COUNT(*) AS count, COALESCE(SUM(event_bytes), 0) AS bytes, COALESCE(MAX(ordinal), -1) AS last_ordinal FROM sandbox_job_events WHERE job_id = ?');
  const insertJob = db.prepare('INSERT INTO sandbox_jobs (job_id, created_at, status, ciphertext) VALUES (?, ?, ?, ?)');
  const insertEvent = db.prepare('INSERT INTO sandbox_job_events (job_id, event_id, ordinal, event_digest, event_bytes, ciphertext) VALUES (?, ?, ?, ?, ?, ?)');
  const updateJob = db.prepare('UPDATE sandbox_jobs SET status = ?, ciphertext = ? WHERE job_id = ?');

  async function create(record) {
    const value = validRecord(record);
    const stored = { ...value, status: 'pending', completedAt: null, usage: null, result: null, artifacts: [] };
    const ciphertext = sealRecord({ key, type: 'sandbox_job', id: value.jobId, value: stored });
    insertJob.run(value.jobId, value.requestedAt, 'pending', ciphertext);
    return Object.freeze({ created: true, jobId: value.jobId });
  }

  async function appendEvent(jobId, event) {
    if (!JOB_ID.test(jobId ?? '') || !event || !EVENT_ID.test(event.eventId ?? '')) throw new TypeError('sandbox_history_event_invalid');
    const job = findJob.get(jobId);
    if (!job) throw new Error('sandbox_history_job_unknown');
    const eventBytes = Buffer.byteLength(canonicalJson(event));
    if (eventBytes > 64 * 1024) throw new Error('sandbox_history_event_too_large');
    const eventDigest = digest(event);
    const existing = findEvent.get(jobId, event.eventId);
    if (existing) {
      if (existing.event_digest !== eventDigest) throw new Error('sandbox_history_event_conflict');
      return Object.freeze({ appended: false, idempotent: true });
    }
    const current = stats.get(jobId);
    if (current.count >= maxEvents) throw new Error('sandbox_history_event_count_exceeded');
    if (current.bytes + eventBytes > maxTotalBytes) throw new Error('sandbox_history_total_size_exceeded');
    const ciphertext = sealRecord({ key, type: 'sandbox_job_event', id: `${jobId}:${event.eventId}`, value: event });
    insertEvent.run(jobId, event.eventId, current.last_ordinal + 1, eventDigest, eventBytes, ciphertext);
    return Object.freeze({ appended: true, idempotent: false });
  }

  async function complete(jobId, completion) {
    if (!JOB_ID.test(jobId ?? '') || !completion || !TERMINAL.has(completion.status)
      || !Number.isSafeInteger(completion.completedAt) || !Array.isArray(completion.artifacts)) {
      throw new TypeError('sandbox_history_completion_invalid');
    }
    const row = findJob.get(jobId);
    if (!row) throw new Error('sandbox_history_job_unknown');
    const current = openRecord({ key, type: 'sandbox_job', id: jobId, ciphertext: row.ciphertext });
    if (TERMINAL.has(current.status)) {
      const desired = { ...current, ...completion };
      if (digest(desired) === digest(current)) return Object.freeze({ completed: false, idempotent: true });
      throw new Error('sandbox_history_completion_conflict');
    }
    const stored = { ...current, ...completion };
    updateJob.run(completion.status, sealRecord({ key, type: 'sandbox_job', id: jobId, value: stored }), jobId);
    return Object.freeze({ completed: true, idempotent: false });
  }

  function read(jobId) {
    if (!JOB_ID.test(jobId ?? '')) throw new TypeError('sandbox_history_job_id_invalid');
    const row = findJob.get(jobId);
    if (!row) return null;
    const job = openRecord({ key, type: 'sandbox_job', id: jobId, ciphertext: row.ciphertext });
    const events = listEvents.all(jobId).map((event) => openRecord({
      key, type: 'sandbox_job_event', id: `${jobId}:${event.event_id}`, ciphertext: event.ciphertext,
    }));
    if (job.status === 'pending') return Object.freeze({ ...job, events: Object.freeze(events) });
    return Object.freeze({
      jobId: job.jobId,
      requestedAt: job.requestedAt,
      request: job.request,
      confirmations: job.confirmations,
      digests: job.digests,
      status: job.status,
      completedAt: job.completedAt,
      usage: job.usage,
      result: job.result,
      artifacts: job.artifacts,
      events: Object.freeze(events),
    });
  }

  return Object.freeze({ create, appendEvent, complete, read });
}
