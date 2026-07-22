import { describe, expect, it, vi } from 'vitest';
import { createRoutedProviderInvoker } from '../src/providers/routed-provider-invoker.mjs';
import { createUsageCollector } from '../src/usage/usage-collector.mjs';

const cloud = Object.freeze({ providerId: 'cloud-a', capability: 'text.generate', locality: 'cloud', network: 'internet', modelId: 'cloud-model' });
const local = Object.freeze({ providerId: 'local-b', capability: 'text.generate', locality: 'local', network: 'none', modelId: 'local-model' });

describe('provider usage integration', () => {
  it('records cloud timeout and local fallback as distinct attempts with one correlation ID', async () => {
    const attempts = [];
    const repository = { recordAttempt: vi.fn(async (attempt) => attempts.push(attempt)) };
    const usageCollector = createUsageCollector({ repository });
    const capabilityRouter = { resolve: vi.fn(() => [cloud, local]) };
    const timeout = Object.assign(new Error('provider_timeout'), { code: 'timeout', rawUsage: { prompt_tokens: 4 } });
    const providerRegistry = {
      invoke: vi.fn().mockRejectedValueOnce(timeout).mockResolvedValueOnce({
        output: 'Bonjour', providerId: 'local-b', modelId: 'local-actual',
        usage: { inputTokens: 5, outputTokens: 2, localComputeMs: 30, completeness: 'final' },
      }),
    };
    const budgetGuard = {
      reserve: vi.fn(async ({ id }) => ({ id, reserved: true })),
      settle: vi.fn(async () => {}),
      release: vi.fn(async () => {}),
    };
    let id = 0;
    let now = 1_000;
    const invoker = createRoutedProviderInvoker({
      capabilityRouter,
      providerRegistry,
      budgetGuard,
      usageCollector,
      idFactory: () => `attempt-${++id}`,
      clock: () => (now += 10),
      estimate: ({ route }) => ({ costMicros: route.locality === 'local' ? 0 : 100, durationMs: 1_000 }),
      normalizeAttempt: ({ context, raw, interrupted }) => ({
        ...context,
        completeness: interrupted ? 'partial' : raw.completeness ?? 'final',
        units: raw,
      }),
      calculateCost: ({ locality }) => ({
        costMicros: locality === 'local' ? 0 : null,
        costKind: locality === 'local' ? 'provider_reported' : 'unknown',
      }),
      failurePolicy: { shouldFallback: ({ error }) => error.code === 'timeout' },
    });

    const result = await invoker.invoke({
      capability: 'text.generate', input: { messages: [] }, sessionId: 'session-1', correlationId: 'corr-1', mode: 'auto',
    });

    expect(result).toMatchObject({ output: 'Bonjour', providerId: 'local-b', modelId: 'local-actual' });
    expect(attempts).toHaveLength(2);
    expect(attempts.map(({ attemptId, providerId, status, correlationId, completeness }) => ({ attemptId, providerId, status, correlationId, completeness })))
      .toEqual([
        { attemptId: 'attempt-1', providerId: 'cloud-a', status: 'timeout', correlationId: 'corr-1', completeness: 'partial' },
        { attemptId: 'attempt-2', providerId: 'local-b', status: 'success', correlationId: 'corr-1', completeness: 'final' },
      ]);
    expect(budgetGuard.reserve).toHaveBeenCalledTimes(2);
    expect(budgetGuard.release).toHaveBeenCalledWith('attempt-1');
    expect(budgetGuard.settle).toHaveBeenCalledWith('attempt-2', expect.objectContaining({ costMicros: 0 }));
  });

  it('returns a provider result even when telemetry persistence fails', async () => {
    const repository = { recordAttempt: vi.fn(async () => { throw new Error('telemetry_down'); }) };
    const events = [];
    const usageCollector = createUsageCollector({ repository, onEvent: (event) => events.push(event) });
    const invoker = createRoutedProviderInvoker({
      capabilityRouter: { resolve: () => [local] },
      providerRegistry: { invoke: async () => ({ output: 'ok', providerId: 'local-b', modelId: 'actual', usage: { localComputeMs: 1 } }) },
      budgetGuard: { reserve: async () => {}, settle: async () => {}, release: async () => {} },
      usageCollector,
      idFactory: () => 'attempt-pending',
      clock: (() => { let value = 0; return () => ++value; })(),
      estimate: () => ({ costMicros: 0, durationMs: 10 }),
      normalizeAttempt: ({ context, raw }) => ({ ...context, units: raw, completeness: 'final' }),
      calculateCost: () => ({ costMicros: 0, costKind: 'provider_reported' }),
    });

    await expect(invoker.invoke({ capability: 'text.generate', input: {}, sessionId: 's', correlationId: 'c' }))
      .resolves.toMatchObject({ output: 'ok' });
    expect(events).toContainEqual(expect.objectContaining({ type: 'usage_record_pending', attemptId: 'attempt-pending' }));
  });
});
