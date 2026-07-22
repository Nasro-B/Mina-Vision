import { randomUUID } from 'node:crypto';
import { computeMetrics, compareMetrics } from './metrics.mjs';

function scoreResult(candidate, fixture, response) {
  const factuallyAccurate = response.claimSupported === fixture.expectedClaimSupported;
  const citationValid = fixture.expectedCitations.length === 0
    || fixture.expectedCitations.every((citation) => response.citations.includes(citation));
  return {
    fixtureId: fixture.fixtureId,
    candidate,
    factuallyAccurate,
    citationValid,
    correctAction: response.action === fixture.expectedAction,
    falseSuccess: response.claimSupported === true && fixture.expectedClaimSupported === false,
    verified: typeof response.claimSupported === 'boolean',
    suspended: false,
    usage: response.usage,
  };
}

function suspendedResult(candidate, fixture) {
  return {
    fixtureId: fixture.fixtureId, candidate, factuallyAccurate: false, citationValid: false,
    correctAction: false, falseSuccess: false, verified: false, suspended: true,
    usage: { latencyMs: 0, tokens: 0, costMicros: 0 },
  };
}

export function createEvaluationEngine({ fixtureStore, domainRegistry, modelRouter, clock } = {}) {
  if (!fixtureStore?.listFixtures) throw new TypeError('evaluation_engine_fixture_store_required');
  if (!modelRouter?.route) throw new TypeError('evaluation_engine_model_router_required');
  if (!clock || (typeof clock !== 'function' && typeof clock.now !== 'function')) {
    throw new TypeError('evaluation_engine_clock_required');
  }

  const runs = new Map();

  return Object.freeze({
    async runSuite({ suiteId, candidates, budget, signal }) {
      const fixtures = fixtureStore.listFixtures(suiteId);
      if (fixtures.length === 0) throw new Error('evaluation_suite_has_no_fixtures');

      const results = [];
      let spentCostMicros = 0;
      let suspend = false;

      for (const candidate of candidates) {
        for (const fixture of fixtures) {
          if (suspend || signal?.aborted || (budget?.maxCostMicros !== undefined && spentCostMicros >= budget.maxCostMicros)) {
            results.push(suspendedResult(candidate, fixture));
            continue;
          }
          // eslint-disable-next-line no-await-in-loop
          const response = await modelRouter.route({ candidate, fixture, domainRegistry, signal });
          const result = scoreResult(candidate, fixture, response);
          results.push(result);
          spentCostMicros += result.usage.costMicros ?? 0;
          if (signal?.aborted) suspend = true;
        }
      }

      const report = Object.freeze({
        runId: randomUUID(),
        suiteId,
        candidates: Object.freeze([...candidates]),
        effectsExecuted: 0,
        metrics: computeMetrics(results),
        results: Object.freeze(results),
      });
      runs.set(report.runId, report);
      return report;
    },

    async compare(runIds) {
      if (!Array.isArray(runIds) || runIds.length !== 2) throw new TypeError('evaluation_compare_requires_two_run_ids');
      const [baseline, candidate] = runIds.map((runId) => {
        const report = runs.get(runId);
        if (!report) throw new Error('evaluation_run_not_found');
        return report;
      });
      return Object.freeze({
        runs: Object.freeze([baseline, candidate]),
        delta: compareMetrics(baseline.metrics, candidate.metrics),
      });
    },
  });
}
