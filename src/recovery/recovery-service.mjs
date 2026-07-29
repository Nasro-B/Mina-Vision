import { project } from './recovery-projector.mjs';

function runDomain(run) {
  const capability = run.steps.at(-1)?.action?.capability;
  return typeof capability === 'string' ? capability.split(':')[0] : null;
}

function runToCaseInput(run, domainReconcilers) {
  const allStepsVerified = run.steps.length > 0 && run.steps.every((step) => step.status === 'verified');
  return {
    accepted: true,
    cancelled: run.status === 'cancelled',
    verified: run.status === 'completed' || allStepsVerified ? true : null,
    effectConfirmedAbsent: false,
    reconciliationAttempted: run.reconciliationAttempts > 0,
    reconcilerAvailable: Boolean(domainReconcilers[runDomain(run)]),
  };
}

export function createRecoveryService({ automationLedger, automationRunner, domainReconcilers = {}, closureRepository = null, clock } = {}) {
  if (!automationLedger?.listRuns || !automationLedger?.getRun) throw new TypeError('recovery_service_ledger_required');
  if (!automationRunner?.reconcile) throw new TypeError('recovery_service_runner_required');
  if (!clock || (typeof clock !== 'function' && typeof clock.now !== 'function')) {
    throw new TypeError('recovery_service_clock_required');
  }
  const now = () => Number(typeof clock === 'function' ? clock() : clock.now());

  async function toCase(run) {
    const { classification, allowedActions } = project(runToCaseInput(run, domainReconcilers));
    const closedManually = closureRepository?.get ? await closureRepository.get(run.runId) : null;
    return Object.freeze({
      caseId: run.runId, automationId: run.automationId, classification, allowedActions, closedManually, run,
    });
  }

  return Object.freeze({
    async listCases(filters = {}) {
      const runs = await automationLedger.listRuns();
      const cases = await Promise.all(runs.filter((run) => run.status !== 'running').map(toCase));
      const visible = filters.includeClosed ? cases : cases.filter((entry) => !entry.closedManually);
      return filters.classification
        ? visible.filter((entry) => entry.classification === filters.classification)
        : visible;
    },

    async reconcile(caseId) {
      await automationRunner.reconcile(caseId);
      const run = await automationLedger.getRun(caseId);
      return toCase(run);
    },

    async proposeNextAction(caseId) {
      const run = await automationLedger.getRun(caseId);
      if (!run) throw new Error('automation_run_not_found');
      return (await toCase(run)).allowedActions[0] ?? null;
    },

    async closeManually(caseId, note) {
      const run = await automationLedger.getRun(caseId);
      if (!run) throw new Error('automation_run_not_found');
      if (typeof note !== 'string' || note.trim().length === 0) throw new TypeError('recovery_close_note_required');
      if (!closureRepository?.put) throw new Error('recovery_manual_closure_storage_unavailable');
      const closure = Object.freeze({ caseId, note, closedAt: now() });
      await closureRepository.put(caseId, closure);
      return closure;
    },
  });
}
