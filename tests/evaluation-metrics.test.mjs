import { describe, expect, it } from 'vitest';
import { compareMetrics, computeMetrics } from '../src/evaluation/metrics.mjs';

function result(overrides = {}) {
  return {
    factuallyAccurate: true, citationValid: true, correctAction: true, falseSuccess: false, verified: true,
    suspended: false, usage: { latencyMs: 100, tokens: 50, costMicros: 10 },
    ...overrides,
  };
}

describe('computeMetrics', () => {
  it('computes the nine documented metrics from a set of scored results', () => {
    const metrics = computeMetrics([result(), result({ factuallyAccurate: false, falseSuccess: true })]);
    expect(Object.keys(metrics).sort()).toEqual([
      'citationValidity', 'correctAction', 'factualAccuracy', 'falseSuccessRate', 'latencyMsAvg',
      'suspensionRate', 'totalCostMicros', 'totalTokens', 'verificationRate',
    ]);
  });

  it('computes falseSuccessRate as the fraction of results that falsely claimed success', () => {
    const metrics = computeMetrics([result(), result({ falseSuccess: true }), result({ falseSuccess: true })]);
    expect(metrics.falseSuccessRate).toBeCloseTo(2 / 3);
  });

  it('excludes suspended results from ratio metrics but still counts their usage', () => {
    const metrics = computeMetrics([
      result(),
      result({ suspended: true, factuallyAccurate: false, usage: { latencyMs: 0, tokens: 5, costMicros: 1 } }),
    ]);
    expect(metrics.factualAccuracy).toBe(1);
    expect(metrics.suspensionRate).toBeCloseTo(0.5);
    expect(metrics.totalTokens).toBe(55);
  });

  it('returns zeroed ratio metrics for an empty result set rather than NaN', () => {
    const metrics = computeMetrics([]);
    expect(metrics.factualAccuracy).toBe(0);
    expect(metrics.falseSuccessRate).toBe(0);
    expect(Number.isNaN(metrics.factualAccuracy)).toBe(false);
  });
});

describe('compareMetrics: regression delta between two runs', () => {
  it('computes a positive delta when the candidate improves on the baseline', () => {
    const baseline = computeMetrics([result({ factuallyAccurate: false })]);
    const candidate = computeMetrics([result({ factuallyAccurate: true })]);
    const delta = compareMetrics(baseline, candidate);
    expect(delta.factualAccuracy).toBeCloseTo(1);
  });

  it('computes a negative delta when the candidate regresses (higher falseSuccessRate)', () => {
    const baseline = computeMetrics([result({ falseSuccess: false })]);
    const candidate = computeMetrics([result({ falseSuccess: true })]);
    const delta = compareMetrics(baseline, candidate);
    expect(delta.falseSuccessRate).toBeCloseTo(1);
  });
});
