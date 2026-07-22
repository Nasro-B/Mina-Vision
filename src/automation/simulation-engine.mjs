import { randomUUID } from 'node:crypto';
import { isActionAllowed } from './automation-contracts.mjs';
import { canonicalJson } from '../crypto/canonical-json.mjs';
import { sha256 } from '../crypto/digest.mjs';

export function createSimulationEngine({ domainRegistry, budgetEstimator, disclosureClassifier, clock } = {}) {
  if (!domainRegistry?.simulate) throw new TypeError('simulation_engine_domain_registry_required');
  if (!budgetEstimator) throw new TypeError('simulation_engine_budget_estimator_required');
  if (!disclosureClassifier) throw new TypeError('simulation_engine_disclosure_classifier_required');
  if (!clock || (typeof clock !== 'function' && typeof clock.now !== 'function')) {
    throw new TypeError('simulation_engine_clock_required');
  }

  return Object.freeze({
    async simulate({ definition, trigger, context }) {
      const actions = trigger.payload.actions ?? [];
      for (const action of actions) {
        if (!isActionAllowed(definition, action)) {
          throw new Error('automation_action_not_allowed');
        }
      }

      const uncertainties = [];
      for (const action of actions) {
        // eslint-disable-next-line no-await-in-loop
        const outcome = await domainRegistry.simulate(action, context);
        if (outcome?.uncertainty) uncertainties.push(outcome.uncertainty);
      }

      const disclosures = await disclosureClassifier(actions, context);
      const estimatedUsage = await budgetEstimator(actions, context);
      const payload = {
        automationId: definition.automationId,
        definitionVersion: definition.version,
        triggerId: trigger.triggerId,
        proposedActions: actions,
      };

      return Object.freeze({
        simulationId: randomUUID(),
        digest: sha256(canonicalJson(payload)),
        proposedActions: Object.freeze(actions),
        disclosures: Object.freeze(disclosures),
        uncertainties: Object.freeze(uncertainties),
        estimatedUsage,
      });
    },
  });
}
