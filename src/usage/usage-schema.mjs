import { createHash } from 'node:crypto';

export const USAGE_UNIT_KEYS = Object.freeze([
  'inputTokens',
  'cachedInputTokens',
  'outputTokens',
  'reasoningTokens',
  'inputImages',
  'inputAudioSeconds',
  'outputAudioSeconds',
  'localComputeMs',
]);

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function validId(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 300;
}

function unitsOf(values = {}) {
  const units = Object.fromEntries(USAGE_UNIT_KEYS.map((key) => [key, values[key] ?? null]));
  if (Object.values(units).some((value) => value !== null && (!Number.isFinite(value) || value < 0))) {
    throw new TypeError('usage_units_invalid');
  }
  return Object.freeze(units);
}

export function createUsageAttempt({ context, raw = {}, units = {}, completeness = 'partial' } = {}) {
  const started = Date.parse(context?.startedAt);
  const ended = Date.parse(context?.endedAt);
  if (!validId(context?.attemptId) || !validId(context?.providerId) || !validId(context?.modelId)
    || !validId(context?.capability) || (context.sessionId !== null && context.sessionId !== undefined && !validId(context.sessionId))
    || (context.correlationId !== null && context.correlationId !== undefined && !validId(context.correlationId))
    || !['success', 'error', 'timeout', 'cancelled'].includes(context?.status)
    || !['local', 'cloud'].includes(context?.locality)
    || !Number.isFinite(started) || !Number.isFinite(ended) || ended < started
    || !['partial', 'final'].includes(completeness)) {
    throw new TypeError('usage_attempt_invalid');
  }
  const rawDigest = `sha256:${createHash('sha256').update(JSON.stringify(canonical(raw))).digest('hex')}`;
  return Object.freeze({
    attemptId: context.attemptId,
    sessionId: context.sessionId ?? null,
    correlationId: context.correlationId ?? null,
    providerId: context.providerId,
    modelId: context.modelId,
    capability: context.capability,
    startedAt: new Date(started).toISOString(),
    endedAt: new Date(ended).toISOString(),
    latencyMs: ended - started,
    status: context.status,
    locality: context.locality,
    units: unitsOf(units),
    completeness,
    rawDigest,
  });
}

export function measured(value) {
  return value === undefined || value === null ? null : Number(value);
}
