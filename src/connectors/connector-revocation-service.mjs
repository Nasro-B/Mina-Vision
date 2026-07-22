import { canTransition } from '../automation/automation-contracts.mjs';

export function createConnectorRevocationService({ trustStore, registry, automationDefinitionStore, clock } = {}) {
  if (!trustStore?.revokePublisher || !trustStore?.getTrust) throw new TypeError('connector_revocation_service_trust_store_required');
  if (!registry?.list) throw new TypeError('connector_revocation_service_registry_required');
  if (!automationDefinitionStore?.list || !automationDefinitionStore?.transition) {
    throw new TypeError('connector_revocation_service_automation_store_required');
  }
  if (!clock || (typeof clock !== 'function' && typeof clock.now !== 'function')) {
    throw new TypeError('connector_revocation_service_clock_required');
  }
  const now = () => Number(typeof clock === 'function' ? clock() : clock.now());

  return Object.freeze({
    // Revokes trust for a publisher (all its connector versions become unstageable/unactivatable
    // from that point on, since connector-version-service re-checks trustStore.isApproved on every
    // stageUpdate/activateVersion — that is what "disables all versions" means here, rather than a
    // separate per-version disable flag). Then suspends every automation whose allowedActions
    // depend on a capability declared by one of that publisher's registered connectors.
    async revokePublisher(publisherId) {
      const trust = await trustStore.getTrust(publisherId);
      if (!trust) throw new Error('publisher_not_found');
      await trustStore.revokePublisher(publisherId);

      const allConnectors = await registry.list();
      const affectedConnectors = allConnectors.filter((entry) => entry.manifest.publisherId === publisherId);
      const affectedCapabilities = new Set(affectedConnectors.flatMap((entry) => entry.manifest.capabilities ?? []));

      const suspendedAutomationIds = [];
      if (affectedCapabilities.size > 0) {
        const definitions = await automationDefinitionStore.list();
        for (const definition of definitions) {
          const dependsOnRevoked = (definition.allowedActions ?? []).some((action) => affectedCapabilities.has(action.capability));
          if (!dependsOnRevoked) continue;
          if (!canTransition(definition.status, 'suspended')) continue;
          await automationDefinitionStore.transition(definition.automationId, 'suspended');
          suspendedAutomationIds.push(definition.automationId);
        }
      }

      return Object.freeze({
        publisherId,
        revokedAt: new Date(now()).toISOString(),
        connectorIds: Object.freeze(affectedConnectors.map((entry) => entry.connectorId)),
        suspendedAutomationIds: Object.freeze(suspendedAutomationIds),
      });
    },
  });
}
