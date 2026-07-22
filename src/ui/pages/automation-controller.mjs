import { normalizeTrigger } from '../../automation/trigger-normalizer.mjs';

function redactStep(step) {
  return Object.freeze({
    key: step.key,
    index: step.index,
    status: step.status,
    actionType: step.action?.actionType ?? null,
    capability: step.action?.capability ?? null,
    recordedAt: step.recordedAt,
    updatedAt: step.updatedAt,
  });
}

export function redactRun(run) {
  if (!run) return null;
  return Object.freeze({
    runId: run.runId,
    automationId: run.automationId,
    simulationId: run.simulationId,
    digest: run.digest,
    status: run.status,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    reconciliationAttempts: run.reconciliationAttempts,
    steps: Object.freeze(run.steps.map(redactStep)),
  });
}

export function createAutomationController({
  automationDefinitionStore,
  automationGrantStore,
  simulationEngine,
  automationPolicy,
  automationLedger,
  healthMonitor,
} = {}) {
  if (!automationDefinitionStore?.create || !automationGrantStore?.create || !simulationEngine?.simulate
    || !automationPolicy?.evaluate || !automationLedger?.getRun) {
    throw new TypeError('automation_controller_dependencies_required');
  }

  return Object.freeze({
    listDefinitions: () => automationDefinitionStore.list(),
    getDefinition: (automationId) => automationDefinitionStore.get(automationId),
    createDefinition: (input) => automationDefinitionStore.create(input),
    transitionDefinition: ({ automationId, nextStatus, expectedVersion } = {}) => (
      automationDefinitionStore.transition(automationId, nextStatus, { expectedVersion })
    ),
    createGrant: (input) => automationGrantStore.create(input),

    async simulate({ automationId, trigger, context } = {}) {
      const definition = await automationDefinitionStore.get(automationId);
      if (!definition) throw new Error('automation_definition_not_found');
      return simulationEngine.simulate({ definition, trigger: normalizeTrigger(trigger), context });
    },

    async evaluate({ automationId, grantId, trigger, simulation, context } = {}) {
      const definition = await automationDefinitionStore.get(automationId);
      if (!definition) throw new Error('automation_definition_not_found');
      const grant = grantId ? await automationGrantStore.get(grantId) : null;
      return automationPolicy.evaluate({ definition, grant, trigger: normalizeTrigger(trigger), simulation, context });
    },

    async getRun(runId) {
      return redactRun(await automationLedger.getRun(runId));
    },

    async listRuns(filters) {
      return (await automationLedger.listRuns(filters)).map(redactRun);
    },

    async healthSnapshot() {
      return healthMonitor ? healthMonitor.snapshot() : [];
    },
  });
}
