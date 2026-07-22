import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { createAnalyticsQuery } from '../src/usage/analytics-query.mjs';
import { applyUsageMigrations, createUsageRepository } from '../src/usage/usage-repository.mjs';

let db;
let repository;
let analytics;

function row(id, overrides = {}) {
  const start = Date.parse(overrides.startedAt ?? `2026-07-15T0${id}:00:00.000Z`);
  const latencyMs = overrides.latencyMs ?? id * 100;
  return {
    attemptId: `attempt-${id}`,
    sessionId: 'session-1',
    correlationId: overrides.correlationId ?? `corr-${id}`,
    providerId: overrides.providerId ?? 'gemini',
    modelId: overrides.modelId ?? 'gemini-3.5-flash',
    capability: overrides.capability ?? 'text.generate',
    channel: overrides.channel ?? 'desktop',
    startedAt: new Date(start).toISOString(),
    endedAt: new Date(start + latencyMs).toISOString(),
    latencyMs,
    status: overrides.status ?? 'success',
    locality: overrides.locality ?? 'cloud',
    completeness: overrides.completeness ?? 'final',
    rawDigest: `sha256:${id}`,
    units: {
      inputTokens: overrides.inputTokens ?? 10,
      cachedInputTokens: 0,
      outputTokens: overrides.outputTokens ?? 5,
      reasoningTokens: null,
      inputImages: 0,
      inputAudioSeconds: 0,
      outputAudioSeconds: 0,
      localComputeMs: overrides.localComputeMs ?? null,
    },
    cost: {
      costMicros: overrides.costMicros === undefined ? 10 : overrides.costMicros,
      providerCostMicros: null,
      currency: overrides.costMicros === null ? null : 'USD',
      costKind: overrides.costMicros === null ? 'unknown' : 'catalog_estimate',
      pricingRevision: null,
    },
    errorCategory: overrides.errorCategory ?? null,
  };
}

beforeEach(async () => {
  db = new Database(':memory:');
  applyUsageMigrations(db);
  repository = createUsageRepository({ db, encryptionKey: Buffer.alloc(32, 79) });
  analytics = createAnalyticsQuery({ db });
  await repository.recordAttempt(row(1, { correlationId: 'fallback-corr', status: 'timeout', latencyMs: 100, costMicros: null }));
  await repository.recordAttempt(row(2, { correlationId: 'fallback-corr', providerId: 'lm-studio', modelId: 'qwen-local', locality: 'local', status: 'success', latencyMs: 200, costMicros: 0, localComputeMs: 180 }));
  await repository.recordAttempt(row(3, { correlationId: 'single-corr', providerId: 'deepseek', modelId: 'deepseek-v4-flash', channel: 'telegram', latencyMs: 300, costMicros: 30 }));
  await repository.recordAttempt(row(4, { correlationId: 'single-2', providerId: 'deepseek', modelId: 'deepseek-v4-flash', channel: 'telegram', status: 'error', latencyMs: 400, costMicros: 40 }));
});

describe('usage analytics query', () => {
  it('filters all supported dimensions and returns paginated rows', () => {
    const result = analytics.query({
      from: '2026-07-15T00:00:00.000Z',
      to: '2026-07-15T23:59:59.999Z',
      filters: {
        provider: 'deepseek', model: 'deepseek-v4-flash', capability: 'text.generate',
        channel: 'telegram', locality: 'cloud', status: 'success',
      },
      page: 1,
      pageSize: 1,
    });

    expect(result.total).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ providerId: 'deepseek', channel: 'telegram', status: 'success' });
  });

  it('calculates totals, p50/p95 latency, success, fallback and budget consumption', () => {
    const result = analytics.query({
      from: '2026-07-15T00:00:00.000Z', to: '2026-07-15T23:59:59.999Z', pageSize: 10,
    });

    expect(result.aggregates).toMatchObject({
      attempts: 4,
      successCount: 2,
      successRate: 0.5,
      correlations: 3,
      fallbackCorrelations: 1,
      fallbackRate: 1 / 3,
      p50LatencyMs: 250,
      p95LatencyMs: 385,
      budgetConsumptionMicros: 70,
      unknownCostAttempts: 1,
      inputTokens: 40,
      outputTokens: 20,
      localComputeMs: 180,
    });
  });
});
