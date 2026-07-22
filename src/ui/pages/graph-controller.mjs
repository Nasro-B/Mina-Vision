const DEFAULT_POLICY = Object.freeze({ allowedClassifications: ['personal'], maxNodes: 50, maxEdges: 100 });

export function createGraphController({ personalGraph, entityResolver = null, contactService = null } = {}) {
  if (!personalGraph?.subgraph) throw new TypeError('graph_controller_dependencies_required');

  return Object.freeze({
    getSubgraph: ({ startEntityId, maxDepth = 1, policy } = {}) => (
      personalGraph.subgraph({ startEntityId, maxDepth }, { ...DEFAULT_POLICY, ...policy })
    ),
    upsertEntity: (input) => personalGraph.upsertEntity(input),
    proposeEdge: (input) => personalGraph.proposeEdge(input),
    confirmEdge: (edgeId) => personalGraph.confirmEdge(edgeId),
    disputeEdge: ({ edgeId, reason } = {}) => personalGraph.disputeEdge(edgeId, reason),
    forgetEntity: (entityId) => personalGraph.forgetEntity(entityId),

    async resolveEntity(input) {
      if (!entityResolver) throw new Error('entity_resolver_not_configured');
      return entityResolver.resolve(input);
    },

    async listContacts() {
      if (!contactService) return [];
      return contactService.list ? contactService.list() : [];
    },

    async resolveContactEndpoint(input) {
      if (!contactService) throw new Error('contact_service_not_configured');
      return contactService.resolveEndpoint(input);
    },
  });
}
