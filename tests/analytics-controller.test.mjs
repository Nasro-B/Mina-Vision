import { describe, expect, it, vi } from 'vitest';
import { createAnalyticsController } from '../src/ui/pages/analytics-controller.mjs';

const queryResult = {
  items: [{
    attemptId: 'a-1', providerId: '=deepseek', modelId: 'deepseek-v4-flash', capability: 'text.generate',
    channel: 'desktop', startedAt: '2026-07-15T06:00:00.000Z', endedAt: '2026-07-15T06:00:00.010Z',
    latencyMs: 10, status: 'success', locality: 'cloud', completeness: 'final', costMicros: 1,
    currency: 'USD', costKind: 'catalog_estimate', errorCategory: null,
    prompt: 'DO_NOT_EXPORT', response: 'DO_NOT_EXPORT', routeMetadata: { secret: 'DO_NOT_EXPORT' },
  }],
  total: 1,
  page: 1,
  pageSize: 50,
  aggregates: { attempts: 1, budgetConsumptionMicros: 1 },
  series: { attemptsByDay: [{ date: '2026-07-15', value: 1 }] },
};

function setup(overrides = {}) {
  const dependencies = {
    analyticsQuery: { query: vi.fn(() => queryResult) },
    budgetGuard: { snapshot: vi.fn(async (scope) => ({ scope: scope.type, id: scope.id ?? 'today' })) },
    confirmLocal: vi.fn(async () => true),
    selectExportPath: vi.fn(async ({ format }) => `C:\\Exports\\mina-usage.${format}`),
    writer: { writeAtomic: vi.fn(async ({ path }) => ({ path, bytes: 10 })) },
    ...overrides,
  };
  return { dependencies, controller: createAnalyticsController(dependencies) };
}

describe('analytics page controller', () => {
  it('validates a bounded period and returns chart-ready data', async () => {
    const { controller, dependencies } = setup();
    const request = {
      from: '2026-07-01T00:00:00.000Z', to: '2026-07-15T23:59:59.999Z',
      filters: { provider: 'deepseek', channel: 'desktop' }, page: 1, pageSize: 50,
    };
    await expect(controller.query(request)).resolves.toMatchObject({
      total: 1, series: { attemptsByDay: [{ date: '2026-07-15', value: 1 }] },
    });
    expect(dependencies.analyticsQuery.query).toHaveBeenCalledWith(request);

    await expect(controller.query({ from: '2024-01-01T00:00:00.000Z', to: '2026-07-15T00:00:00.000Z' }))
      .rejects.toThrow('analytics_period_too_large');
    await expect(controller.query({ from: 'bad', to: 'also-bad' })).rejects.toThrow('analytics_period_invalid');
  });

  it('validates budget snapshot scopes', async () => {
    const { controller, dependencies } = setup();
    await expect(controller.budgetSnapshot({ type: 'provider', id: 'deepseek' }))
      .resolves.toMatchObject({ scope: 'provider', id: 'deepseek' });
    expect(dependencies.budgetGuard.snapshot).toHaveBeenCalledWith({ type: 'provider', id: 'deepseek' });
    await expect(controller.budgetSnapshot({ type: 'provider' })).rejects.toThrow('analytics_budget_scope_invalid');
  });

  it('requires confirmation and a picker-selected path before a redacted CSV export', async () => {
    const { controller, dependencies } = setup();
    const result = await controller.export({
      format: 'csv', from: '2026-07-01T00:00:00.000Z', to: '2026-07-15T23:59:59.999Z',
    });
    expect(result).toMatchObject({ exported: true, path: 'C:\\Exports\\mina-usage.csv' });
    expect(dependencies.confirmLocal).toHaveBeenCalledOnce();
    const [{ content, path }] = dependencies.writer.writeAtomic.mock.calls[0];
    expect(path).toBe('C:\\Exports\\mina-usage.csv');
    expect(content).not.toContain('DO_NOT_EXPORT');
    expect(content).toContain("'=deepseek");
  });

  it('does not pick or write a path when export confirmation is refused', async () => {
    const { controller, dependencies } = setup({ confirmLocal: vi.fn(async () => false) });
    await expect(controller.export({
      format: 'json', from: '2026-07-01T00:00:00.000Z', to: '2026-07-15T23:59:59.999Z',
    })).rejects.toThrow('analytics_export_refused');
    expect(dependencies.selectExportPath).not.toHaveBeenCalled();
    expect(dependencies.writer.writeAtomic).not.toHaveBeenCalled();
  });
});
