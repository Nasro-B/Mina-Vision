import { describe, expect, it, vi } from 'vitest';
import { createFixtureStore } from '../src/evaluation/fixture-store.mjs';
import { createEvaluationEngine } from '../src/evaluation/evaluation-engine.mjs';

function fakeDomains() {
  return { invoke: vi.fn(), execute: vi.fn(), simulate: vi.fn(async () => ({ preview: 'noop' })) };
}

function setup() {
  const fixtureStore = createFixtureStore();
  fixtureStore.addFixture('grounding-v1', {
    fixtureId: 'f1', prompt: 'Quelle heure est-il ?', expectedAction: null, expectedClaimSupported: true, expectedCitations: [],
  });
  fixtureStore.addFixture('grounding-v1', {
    fixtureId: 'f2', prompt: 'Envoie un message à Paul', expectedAction: 'notify', expectedClaimSupported: true, expectedCitations: ['source-1'],
  });
  return fixtureStore;
}

describe('createEvaluationEngine: constructor guards', () => {
  it('requires a fixtureStore', () => {
    expect(() => createEvaluationEngine({ domainRegistry: fakeDomains(), modelRouter: { route: vi.fn() }, clock: () => 0 }))
      .toThrow('evaluation_engine_fixture_store_required');
  });

  it('requires a modelRouter', () => {
    expect(() => createEvaluationEngine({ fixtureStore: setup(), domainRegistry: fakeDomains(), clock: () => 0 }))
      .toThrow('evaluation_engine_model_router_required');
  });
});

describe('createEvaluationEngine.runSuite: never executes a real effect', () => {
  it('never calls invoke or execute on the domain registry, and reports effectsExecuted 0', async () => {
    const domainRegistry = fakeDomains();
    const modelRouter = { route: vi.fn(async () => ({ text: 'ok', action: null, claimSupported: true, citations: [], usage: { latencyMs: 10, tokens: 5, costMicros: 1 } })) };
    const engine = createEvaluationEngine({ fixtureStore: setup(), domainRegistry, modelRouter, clock: () => 0 });

    const report = await engine.runSuite({ suiteId: 'grounding-v1', candidates: ['local-a', 'cloud-b'] });

    expect(domainRegistry.invoke).not.toHaveBeenCalled();
    expect(domainRegistry.execute).not.toHaveBeenCalled();
    expect(report.effectsExecuted).toBe(0);
    expect(report.metrics).toHaveProperty('falseSuccessRate');
  });

  it('throws for a suiteId with no registered fixtures', async () => {
    const engine = createEvaluationEngine({ fixtureStore: setup(), domainRegistry: fakeDomains(), modelRouter: { route: vi.fn() }, clock: () => 0 });
    await expect(engine.runSuite({ suiteId: 'unknown-suite', candidates: ['a'] })).rejects.toThrow('evaluation_suite_has_no_fixtures');
  });
});

describe('createEvaluationEngine.runSuite: scoring against fixtures', () => {
  it('scores every candidate against every fixture and passes the domain registry through to modelRouter', async () => {
    const domainRegistry = fakeDomains();
    const modelRouter = {
      route: vi.fn(async ({ fixture }) => ({
        text: 'ok', action: fixture.expectedAction, claimSupported: fixture.expectedClaimSupported,
        citations: fixture.expectedCitations, usage: { latencyMs: 10, tokens: 5, costMicros: 1 },
      })),
    };
    const engine = createEvaluationEngine({ fixtureStore: setup(), domainRegistry, modelRouter, clock: () => 0 });
    const report = await engine.runSuite({ suiteId: 'grounding-v1', candidates: ['local-a', 'cloud-b'] });

    expect(modelRouter.route).toHaveBeenCalledTimes(4);
    expect(modelRouter.route).toHaveBeenCalledWith(expect.objectContaining({ candidate: 'local-a', domainRegistry }));
    expect(report.results).toHaveLength(4);
    expect(report.metrics.correctAction).toBe(1);
    expect(report.metrics.citationValidity).toBe(1);
  });

  it('flags a false success when the candidate claims support the fixture says should not be supported', async () => {
    const fixtureStore = createFixtureStore();
    fixtureStore.addFixture('s1', { fixtureId: 'f1', prompt: 'p', expectedClaimSupported: false, expectedCitations: [] });
    const modelRouter = { route: vi.fn(async () => ({ text: 'ok', action: null, claimSupported: true, citations: [], usage: { latencyMs: 1, tokens: 1, costMicros: 1 } })) };
    const engine = createEvaluationEngine({ fixtureStore, domainRegistry: fakeDomains(), modelRouter, clock: () => 0 });
    const report = await engine.runSuite({ suiteId: 's1', candidates: ['a'] });
    expect(report.metrics.falseSuccessRate).toBe(1);
  });
});

describe('createEvaluationEngine.runSuite: budget suspension', () => {
  it('suspends remaining fixture/candidate pairs once the budget is exhausted, without calling modelRouter for them', async () => {
    const modelRouter = { route: vi.fn(async () => ({ text: 'ok', action: null, claimSupported: true, citations: [], usage: { latencyMs: 1, tokens: 1, costMicros: 10 } })) };
    const engine = createEvaluationEngine({ fixtureStore: setup(), domainRegistry: fakeDomains(), modelRouter, clock: () => 0 });
    const report = await engine.runSuite({ suiteId: 'grounding-v1', candidates: ['local-a', 'cloud-b'], budget: { maxCostMicros: 15 } });

    expect(modelRouter.route).toHaveBeenCalledTimes(2);
    expect(report.results.filter((r) => r.suspended)).toHaveLength(2);
    expect(report.metrics.suspensionRate).toBe(0.5);
  });

  it('stops calling modelRouter once the signal is aborted', async () => {
    const controller = new AbortController();
    const modelRouter = {
      route: vi.fn(async () => {
        controller.abort();
        return { text: 'ok', action: null, claimSupported: true, citations: [], usage: { latencyMs: 1, tokens: 1, costMicros: 1 } };
      }),
    };
    const engine = createEvaluationEngine({ fixtureStore: setup(), domainRegistry: fakeDomains(), modelRouter, clock: () => 0 });
    const report = await engine.runSuite({ suiteId: 'grounding-v1', candidates: ['local-a', 'cloud-b'], signal: controller.signal });

    expect(modelRouter.route).toHaveBeenCalledTimes(1);
    expect(report.results.filter((r) => r.suspended)).toHaveLength(3);
  });
});

describe('createEvaluationEngine.compare: regression delta across two runs', () => {
  it('compares two stored runs by runId and returns a metric-by-metric delta', async () => {
    const fixtureStore = createFixtureStore();
    fixtureStore.addFixture('s1', { fixtureId: 'f1', prompt: 'p', expectedClaimSupported: true, expectedCitations: [] });
    let claimSupported = false;
    const modelRouter = { route: vi.fn(async () => ({ text: 'ok', action: null, claimSupported, citations: [], usage: { latencyMs: 1, tokens: 1, costMicros: 1 } })) };
    const engine = createEvaluationEngine({ fixtureStore, domainRegistry: fakeDomains(), modelRouter, clock: () => 0 });

    const baseline = await engine.runSuite({ suiteId: 's1', candidates: ['a'] });
    claimSupported = true;
    const improved = await engine.runSuite({ suiteId: 's1', candidates: ['a'] });

    const comparison = await engine.compare([baseline.runId, improved.runId]);
    expect(comparison.delta.factualAccuracy).toBeCloseTo(1);
  });

  it('rejects comparing anything other than exactly two runIds', async () => {
    const engine = createEvaluationEngine({ fixtureStore: setup(), domainRegistry: fakeDomains(), modelRouter: { route: vi.fn() }, clock: () => 0 });
    await expect(engine.compare(['only-one'])).rejects.toThrow('evaluation_compare_requires_two_run_ids');
  });

  it('rejects comparing an unknown runId', async () => {
    const engine = createEvaluationEngine({ fixtureStore: setup(), domainRegistry: fakeDomains(), modelRouter: { route: vi.fn(async () => ({ text: '', action: null, claimSupported: true, citations: [], usage: { latencyMs: 1, tokens: 1, costMicros: 1 } })) }, clock: () => 0 });
    const report = await engine.runSuite({ suiteId: 'grounding-v1', candidates: ['a'] });
    await expect(engine.compare([report.runId, 'missing'])).rejects.toThrow('evaluation_run_not_found');
  });
});
