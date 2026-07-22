function mean(values) {
  if (values.length === 0) return 0;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

export function computeMetrics(results) {
  const scored = results.filter((result) => !result.suspended);
  return Object.freeze({
    factualAccuracy: mean(scored.map((result) => (result.factuallyAccurate ? 1 : 0))),
    citationValidity: mean(scored.map((result) => (result.citationValid ? 1 : 0))),
    correctAction: mean(scored.map((result) => (result.correctAction ? 1 : 0))),
    falseSuccessRate: mean(scored.map((result) => (result.falseSuccess ? 1 : 0))),
    verificationRate: mean(scored.map((result) => (result.verified ? 1 : 0))),
    latencyMsAvg: mean(scored.map((result) => result.usage.latencyMs)),
    totalTokens: sum(results.map((result) => result.usage?.tokens ?? 0)),
    totalCostMicros: sum(results.map((result) => result.usage?.costMicros ?? 0)),
    suspensionRate: mean(results.map((result) => (result.suspended ? 1 : 0))),
  });
}

export function compareMetrics(baseline, candidate) {
  const delta = {};
  for (const key of Object.keys(baseline)) {
    delta[key] = candidate[key] - baseline[key];
  }
  return Object.freeze(delta);
}
