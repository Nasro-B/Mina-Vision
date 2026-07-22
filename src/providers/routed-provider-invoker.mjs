import { randomUUID } from 'node:crypto';

function statusOf(error) {
  if (error?.name === 'AbortError') return 'cancelled';
  if (error?.code === 'timeout' || /timeout/iu.test(error?.message ?? '')) return 'timeout';
  return 'error';
}

export function createRoutedProviderInvoker({
  capabilityRouter,
  providerRegistry,
  budgetGuard,
  usageCollector,
  normalizeAttempt,
  calculateCost,
  estimate,
  failurePolicy,
  idFactory = randomUUID,
  clock = Date.now,
} = {}) {
  if (!capabilityRouter?.resolve || !providerRegistry?.invoke || !budgetGuard?.reserve
    || !budgetGuard?.settle || !budgetGuard?.release || !usageCollector?.record
    || typeof normalizeAttempt !== 'function' || typeof calculateCost !== 'function'
    || typeof estimate !== 'function') {
    throw new TypeError('routed_provider_invoker_dependencies_required');
  }
  const now = () => Number(typeof clock === 'function' ? clock() : clock.now());

  function contextFor({ attemptId, sessionId, correlationId, route, result, capability, started, ended, status }) {
    return {
      attemptId,
      sessionId: sessionId ?? null,
      correlationId: correlationId ?? null,
      providerId: result?.providerId ?? route.providerId,
      modelId: result?.modelId ?? route.modelId ?? 'unknown',
      capability,
      startedAt: new Date(started).toISOString(),
      endedAt: new Date(ended).toISOString(),
      latencyMs: Math.max(0, ended - started),
      status,
      locality: route.locality,
    };
  }

  async function recordAndSettle({ attempt, reservationId, cost }) {
    await usageCollector.record(Object.freeze({ ...attempt, cost: Object.freeze({ ...cost }) }));
    if (Number.isSafeInteger(cost.costMicros) && cost.costMicros >= 0) {
      await budgetGuard.settle(reservationId, {
        costMicros: cost.costMicros,
        durationMs: attempt.latencyMs,
      });
    } else {
      await budgetGuard.release(reservationId);
    }
  }

  async function invoke({
    capability,
    input,
    sessionId,
    correlationId = randomUUID(),
    mode = 'auto',
    offline = false,
    preferredProvider,
  } = {}) {
    const routes = capabilityRouter.resolve({ capability, mode, offline, preferredProvider });
    if (!routes.length) throw new Error(`provider_route_unavailable:${capability}`);
    let lastError;
    for (let index = 0; index < routes.length; index += 1) {
      const route = routes[index];
      const attemptId = String(idFactory());
      const estimateValue = estimate({ route, input, capability, sessionId });
      await budgetGuard.reserve({
        id: attemptId,
        sessionId,
        providerId: route.providerId,
        costMicros: estimateValue.costMicros,
        durationMs: estimateValue.durationMs,
      });
      const started = now();
      try {
        const result = await providerRegistry.invoke(route, input);
        const ended = now();
        const context = contextFor({
          attemptId, sessionId, correlationId, route, result, capability, started, ended, status: 'success',
        });
        const attempt = normalizeAttempt({ context, raw: result.usage ?? result.rawUsage ?? {}, result, interrupted: false });
        const cost = calculateCost(attempt);
        await recordAndSettle({ attempt, reservationId: attemptId, cost });
        return result;
      } catch (error) {
        const ended = now();
        const status = statusOf(error);
        const context = contextFor({
          attemptId, sessionId, correlationId, route, capability, started, ended, status,
        });
        const attempt = normalizeAttempt({
          context,
          raw: error?.rawUsage ?? {},
          error,
          interrupted: Boolean(error?.rawUsage) || status === 'cancelled' || status === 'timeout',
        });
        const cost = calculateCost(attempt);
        await recordAndSettle({ attempt, reservationId: attemptId, cost });
        lastError = error;
        const nextRoute = routes[index + 1];
        if (!nextRoute || failurePolicy?.shouldFallback?.({ error, route, nextRoute, attempt }) !== true) throw error;
      }
    }
    throw lastError ?? new Error('provider_invocation_failed');
  }

  return Object.freeze({ invoke });
}
