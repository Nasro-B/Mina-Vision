export function createEvaluationController({ evaluationEngine } = {}) {
  if (!evaluationEngine?.runSuite || !evaluationEngine?.compare) {
    throw new TypeError('evaluation_controller_dependencies_required');
  }

  return Object.freeze({
    runSuite: ({ suiteId, candidates, budget } = {}) => evaluationEngine.runSuite({ suiteId, candidates, budget }),
    compareRuns: (runIds) => evaluationEngine.compare(runIds),
  });
}
