import { redactRun } from './automation-controller.mjs';

function redactCase(entry) {
  if (!entry) return null;
  return Object.freeze({
    caseId: entry.caseId,
    automationId: entry.automationId,
    classification: entry.classification,
    allowedActions: entry.allowedActions,
    closedManually: entry.closedManually,
    run: redactRun(entry.run),
  });
}

export function createRecoveryController({ recoveryService } = {}) {
  if (!recoveryService?.listCases || !recoveryService?.reconcile
    || !recoveryService?.proposeNextAction || !recoveryService?.closeManually) {
    throw new TypeError('recovery_controller_dependencies_required');
  }

  return Object.freeze({
    async listCases(filters) {
      return (await recoveryService.listCases(filters)).map(redactCase);
    },
    async reconcileCase(caseId) {
      return redactCase(await recoveryService.reconcile(caseId));
    },
    proposeNextAction: (caseId) => recoveryService.proposeNextAction(caseId),
    closeManually: ({ caseId, note } = {}) => recoveryService.closeManually(caseId, note),
  });
}
