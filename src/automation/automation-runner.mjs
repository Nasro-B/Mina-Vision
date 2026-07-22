export function createAutomationRunner({ ledger, domainRegistry, actionVerifier, clock } = {}) {
  if (!ledger?.startRun || !ledger?.getRun || !ledger?.recordStep || !ledger?.getStepByKey || !ledger?.finishRun) {
    throw new TypeError('automation_runner_ledger_required');
  }
  if (!domainRegistry?.invoke) throw new TypeError('automation_runner_domain_registry_required');
  if (!actionVerifier?.verify) throw new TypeError('automation_runner_action_verifier_required');
  if (!clock || (typeof clock !== 'function' && typeof clock.now !== 'function')) {
    throw new TypeError('automation_runner_clock_required');
  }

  const controllers = new Map();

  async function run({ runId, definition, simulation, decision, signal: callerSignal }) {
    if (decision?.decision !== 'allow') throw new Error('automation_run_requires_allow_decision');

    const existingRun = await ledger.getRun(runId);
    if (existingRun && (existingRun.status === 'completed' || existingRun.status === 'unknown' || existingRun.status === 'cancelled')) {
      return existingRun;
    }
    await ledger.startRun({
      runId, automationId: definition.automationId, simulationId: simulation.simulationId, digest: simulation.digest,
    });

    const controller = new AbortController();
    controllers.set(runId, controller);
    if (callerSignal) callerSignal.addEventListener('abort', () => controller.abort(), { once: true });

    let outcome = 'completed';
    try {
      for (const [index, action] of simulation.proposedActions.entries()) {
        if (controller.signal.aborted) { outcome = 'cancelled'; break; }

        const key = `${runId}:${index}:${simulation.digest}`;
        // eslint-disable-next-line no-await-in-loop
        const existingStep = await ledger.getStepByKey(key);
        if (existingStep) {
          if (existingStep.status === 'unknown') { outcome = 'unknown'; break; }
          continue;
        }

        // eslint-disable-next-line no-await-in-loop
        const receipt = await domainRegistry.invoke({ ...action, idempotencyKey: key, signal: controller.signal });
        // eslint-disable-next-line no-await-in-loop
        const evidence = await actionVerifier.verify({ action, receipt, expectedEffect: action.expectedEffect });
        const status = evidence.confirmed ? 'verified' : 'unknown';
        // eslint-disable-next-line no-await-in-loop
        await ledger.recordStep({ runId, key, index, action, receipt, evidence, status });
        if (!evidence.confirmed) { outcome = 'unknown'; break; }
      }
    } finally {
      controllers.delete(runId);
    }

    return ledger.finishRun({ runId, status: outcome });
  }

  async function cancel(runId) {
    const controller = controllers.get(runId);
    if (!controller) return { cancelled: false };
    controller.abort();
    return { cancelled: true };
  }

  async function reconcile(runId) {
    const existing = await ledger.getRun(runId);
    if (!existing) throw new Error('automation_run_not_found');
    await ledger.recordReconciliationAttempt(runId);

    for (const step of existing.steps.filter((candidate) => candidate.status === 'unknown')) {
      // eslint-disable-next-line no-await-in-loop
      const evidence = await actionVerifier.verify({ action: step.action, receipt: step.receipt, expectedEffect: step.action?.expectedEffect });
      // eslint-disable-next-line no-await-in-loop
      await ledger.updateStepEvidence({ key: step.key, evidence, status: evidence.confirmed ? 'verified' : 'unknown' });
    }

    const refreshed = await ledger.getRun(runId);
    const stillUnknown = refreshed.steps.some((step) => step.status === 'unknown');
    return ledger.finishRun({ runId, status: stillUnknown ? 'unknown' : 'running' });
  }

  return Object.freeze({ run, cancel, reconcile });
}
