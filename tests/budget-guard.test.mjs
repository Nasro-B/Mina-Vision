import { describe, expect, it } from 'vitest';
import { createBudgetGuard, createInMemoryBudgetStore } from '../src/usage/budget-guard.mjs';

function estimate(id, overrides = {}) {
  return { id, sessionId: 'session-1', providerId: 'gemini', costMicros: 400, durationMs: 100, ...overrides };
}

describe('global budget guard', () => {
  it.each([
    [{ perCallMicros: 300 }, estimate('a'), 'per_call_cost'],
    [{ perCallDurationMs: 50 }, estimate('a'), 'per_call_time'],
  ])('denies per-call budgets before reservation', async (limits, value, scope) => {
    const guard = createBudgetGuard({ limits });
    await expect(guard.reserve(value)).rejects.toMatchObject({ code: 'budget_exceeded', scope });
  });

  it('enforces session, daily, provider and time budgets', async () => {
    const guard = createBudgetGuard({
      limits: {
        sessionMicros: 700,
        dailyMicros: 2_000,
        providerDailyMicros: { gemini: 800 },
        sessionDurationMs: 250,
      },
    });
    await guard.reserve(estimate('a'));

    await expect(guard.reserve(estimate('b', { costMicros: 350 })))
      .rejects.toMatchObject({ code: 'budget_exceeded', scope: 'session_cost' });
    await expect(guard.reserve(estimate('c', { sessionId: 'session-2', costMicros: 450 })))
      .rejects.toMatchObject({ code: 'budget_exceeded', scope: 'provider_daily_cost' });
    await expect(guard.reserve(estimate('d', { sessionId: 'session-3', providerId: 'deepseek', durationMs: 200 })))
      .resolves.toMatchObject({ reserved: true });
    await expect(guard.reserve(estimate('e', { sessionId: 'session-1', providerId: 'deepseek', costMicros: 1, durationMs: 151 })))
      .rejects.toMatchObject({ code: 'budget_exceeded', scope: 'session_time' });
  });

  it('serializes concurrent reservations atomically', async () => {
    const guard = createBudgetGuard({ limits: { dailyMicros: 500 }, store: createInMemoryBudgetStore() });

    const results = await Promise.allSettled([
      guard.reserve(estimate('a', { costMicros: 300 })),
      guard.reserve(estimate('b', { costMicros: 300 })),
    ]);

    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(({ status }) => status === 'rejected')[0].reason)
      .toMatchObject({ code: 'budget_exceeded', scope: 'daily_cost' });
  });

  it('releases and settles over/under reservations without losing actual usage', async () => {
    const guard = createBudgetGuard({ limits: { dailyMicros: 1_000 } });
    await guard.reserve(estimate('release', { costMicros: 700 }));
    await guard.release('release');
    await expect(guard.reserve(estimate('under', { costMicros: 700 }))).resolves.toMatchObject({ reserved: true });
    await guard.settle('under', { costMicros: 500, durationMs: 80 });
    await guard.reserve(estimate('over', { costMicros: 400 }));
    await guard.settle('over', { costMicros: 600, durationMs: 120 });

    await expect(guard.snapshot({ type: 'daily' })).resolves.toMatchObject({
      settledCostMicros: 1_100, reservedCostMicros: 0, overBudget: true,
    });
  });

  it('rolls daily/provider budgets at the clock boundary while keeping session totals', async () => {
    let now = Date.parse('2026-07-15T23:59:00.000Z');
    const guard = createBudgetGuard({
      clock: () => now,
      limits: { dailyMicros: 500, sessionMicros: 1_000, providerDailyMicros: { gemini: 500 } },
    });
    await guard.reserve(estimate('day-1', { costMicros: 500 }));
    await guard.settle('day-1', { costMicros: 500, durationMs: 100 });
    now = Date.parse('2026-07-16T00:01:00.000Z');

    await expect(guard.reserve(estimate('day-2', { costMicros: 500 }))).resolves.toMatchObject({ reserved: true });
    await expect(guard.reserve(estimate('session-over', { providerId: 'deepseek', costMicros: 1 })))
      .rejects.toMatchObject({ code: 'budget_exceeded', scope: 'session_cost' });
  });
});
