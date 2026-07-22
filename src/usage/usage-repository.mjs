import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { canonicalJson, openRecord, sealRecord } from '../memory/record-codec.mjs';

const USAGE_SQL = readFileSync(new URL('./migrations/001-usage.sql', import.meta.url), 'utf8');
const MIGRATION = Object.freeze({ version: 1, name: 'usage', sql: USAGE_SQL });
export const ROUTE_KEYS = Object.freeze([
  'routeIndex', 'mode', 'network', 'requestedProviderId', 'requestedModelId',
  'fallbackFromProviderId', 'fallbackReason',
]);
const STATUS = new Set(['success', 'error', 'timeout', 'cancelled']);
const LOCALITY = new Set(['local', 'cloud']);
const COMPLETENESS = new Set(['partial', 'final']);
const COST_KIND = new Set(['provider_reported', 'catalog_estimate', 'unknown']);

function migrationChecksum(migration) {
  return createHash('sha256').update(`${migration.version}\0${migration.name}\0${migration.sql}`).digest('hex');
}

export function applyUsageMigrations(db) {
  if (!db?.exec || !db?.prepare || !db?.transaction) throw new TypeError('usage_database_required');
  db.exec(`
    CREATE TABLE IF NOT EXISTS usage_schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    ) STRICT
  `);
  const checksum = migrationChecksum(MIGRATION);
  const existing = db.prepare('SELECT name, checksum FROM usage_schema_migrations WHERE version = ?').get(MIGRATION.version);
  if (existing) {
    if (existing.name !== MIGRATION.name || existing.checksum !== checksum) throw new Error('usage_migration_checksum_mismatch:1');
    return;
  }
  db.transaction(() => {
    db.exec(MIGRATION.sql);
    db.prepare('INSERT INTO usage_schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)')
      .run(MIGRATION.version, MIGRATION.name, checksum, Date.now());
  })();
}

function boundedText(value, name, { nullable = false, max = 300 } = {}) {
  if ((value === null || value === undefined) && nullable) return null;
  if (typeof value !== 'string' || value.length === 0 || value.length > max) throw new TypeError(`usage_${name}_invalid`);
  return value;
}

function nonNegative(value, name, { integer = false, nullable = true } = {}) {
  if ((value === null || value === undefined) && nullable) return null;
  if (!Number.isFinite(value) || value < 0 || (integer && !Number.isSafeInteger(value))) {
    throw new TypeError(`usage_${name}_invalid`);
  }
  return value;
}

function safeRouteMetadata(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const safe = {};
  for (const key of ROUTE_KEYS) {
    const item = value[key];
    if (item === undefined || item === null) continue;
    if (key === 'routeIndex') {
      if (Number.isSafeInteger(item) && item >= 0 && item <= 100) safe[key] = item;
    } else if (typeof item === 'string' && item.length > 0 && item.length <= 200) {
      safe[key] = item;
    }
  }
  return Object.keys(safe).length ? safe : null;
}

function normalizeAttempt(attempt) {
  const startedAt = Date.parse(attempt?.startedAt);
  const endedAt = Date.parse(attempt?.endedAt);
  if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt) || endedAt < startedAt) throw new TypeError('usage_timestamp_invalid');
  const latencyMs = nonNegative(attempt.latencyMs ?? endedAt - startedAt, 'latency', { integer: true, nullable: false });
  if (!STATUS.has(attempt.status) || !LOCALITY.has(attempt.locality) || !COMPLETENESS.has(attempt.completeness)) {
    throw new TypeError('usage_attempt_classification_invalid');
  }
  const cost = attempt.cost ?? {};
  const costKind = cost.costKind ?? 'unknown';
  if (!COST_KIND.has(costKind)) throw new TypeError('usage_cost_kind_invalid');
  const units = attempt.units ?? {};
  return {
    attemptId: boundedText(attempt.attemptId, 'attempt_id'),
    sessionId: boundedText(attempt.sessionId, 'session_id', { nullable: true }),
    correlationId: boundedText(attempt.correlationId, 'correlation_id', { nullable: true }),
    providerId: boundedText(attempt.providerId, 'provider_id'),
    modelId: boundedText(attempt.modelId, 'model_id'),
    capability: boundedText(attempt.capability, 'capability'),
    channel: boundedText(attempt.channel ?? 'unknown', 'channel', { max: 100 }),
    startedAt,
    endedAt,
    latencyMs,
    status: attempt.status,
    locality: attempt.locality,
    completeness: attempt.completeness,
    rawDigest: boundedText(attempt.rawDigest, 'raw_digest', { nullable: true, max: 100 }),
    inputTokens: nonNegative(units.inputTokens, 'input_tokens', { integer: true }),
    cachedInputTokens: nonNegative(units.cachedInputTokens, 'cached_input_tokens', { integer: true }),
    outputTokens: nonNegative(units.outputTokens, 'output_tokens', { integer: true }),
    reasoningTokens: nonNegative(units.reasoningTokens, 'reasoning_tokens', { integer: true }),
    inputImages: nonNegative(units.inputImages, 'input_images'),
    inputAudioSeconds: nonNegative(units.inputAudioSeconds, 'input_audio_seconds'),
    outputAudioSeconds: nonNegative(units.outputAudioSeconds, 'output_audio_seconds'),
    localComputeMs: nonNegative(units.localComputeMs, 'local_compute_ms'),
    costMicros: nonNegative(cost.costMicros, 'cost_micros', { integer: true }),
    providerCostMicros: nonNegative(cost.providerCostMicros, 'provider_cost_micros', { integer: true }),
    currency: boundedText(cost.currency, 'currency', { nullable: true, max: 10 }),
    costKind,
    pricingRevision: boundedText(cost.pricingRevision, 'pricing_revision', { nullable: true, max: 200 }),
    errorCategory: boundedText(attempt.errorCategory, 'error_category', { nullable: true, max: 100 }),
    routeMetadata: safeRouteMetadata(attempt.routeMetadata),
  };
}

function digestOf(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

export function createUsageRepository({ db, encryptionKey } = {}) {
  const key = Buffer.from(encryptionKey ?? []);
  if (!db?.prepare || key.length !== 32) throw new TypeError('usage_repository_configuration_required');
  const insert = db.prepare(`
    INSERT INTO usage_attempts (
      attempt_id, attempt_digest, session_id, correlation_id, provider_id, model_id, capability, channel,
      started_at, ended_at, latency_ms, status, locality, completeness, raw_digest,
      input_tokens, cached_input_tokens, output_tokens, reasoning_tokens, input_images,
      input_audio_seconds, output_audio_seconds, local_compute_ms, cost_micros, provider_cost_micros,
      currency, cost_kind, pricing_revision, error_category, route_metadata_ciphertext
    ) VALUES (
      @attemptId, @attemptDigest, @sessionId, @correlationId, @providerId, @modelId, @capability, @channel,
      @startedAt, @endedAt, @latencyMs, @status, @locality, @completeness, @rawDigest,
      @inputTokens, @cachedInputTokens, @outputTokens, @reasoningTokens, @inputImages,
      @inputAudioSeconds, @outputAudioSeconds, @localComputeMs, @costMicros, @providerCostMicros,
      @currency, @costKind, @pricingRevision, @errorCategory, @routeMetadataCiphertext
    )
  `);
  const find = db.prepare('SELECT * FROM usage_attempts WHERE attempt_id = ?');

  async function recordAttempt(attempt) {
    const normalized = normalizeAttempt(attempt);
    const attemptDigest = digestOf(normalized);
    const existing = find.get(normalized.attemptId);
    if (existing) {
      if (existing.attempt_digest !== attemptDigest) throw new Error('usage_attempt_conflict');
      return Object.freeze({ recorded: false, idempotent: true });
    }
    const routeMetadataCiphertext = normalized.routeMetadata
      ? sealRecord({ key, type: 'usage_route_metadata', id: normalized.attemptId, value: normalized.routeMetadata })
      : null;
    insert.run({ ...normalized, attemptDigest, routeMetadataCiphertext });
    return Object.freeze({ recorded: true, idempotent: false });
  }

  function getAttempt(attemptId) {
    const row = find.get(attemptId);
    if (!row) return null;
    return Object.freeze({
      attemptId: row.attempt_id,
      sessionId: row.session_id,
      correlationId: row.correlation_id,
      providerId: row.provider_id,
      modelId: row.model_id,
      capability: row.capability,
      channel: row.channel,
      startedAt: new Date(row.started_at).toISOString(),
      endedAt: new Date(row.ended_at).toISOString(),
      latencyMs: row.latency_ms,
      status: row.status,
      locality: row.locality,
      completeness: row.completeness,
      costMicros: row.cost_micros,
      routeMetadata: row.route_metadata_ciphertext ? openRecord({
        key, type: 'usage_route_metadata', id: row.attempt_id, ciphertext: row.route_metadata_ciphertext,
      }) : null,
    });
  }

  return Object.freeze({ recordAttempt, getAttempt });
}
