import { randomUUID } from 'node:crypto';

const EDGE_STATUSES = new Set(['proposed', 'confirmed', 'disputed']);

export function createPersonalGraph({ repository, clock } = {}) {
  if (!repository?.putEntity || !repository?.putEdge) throw new TypeError('personal_graph_repository_required');
  if (!clock || (typeof clock !== 'function' && typeof clock.now !== 'function')) {
    throw new TypeError('personal_graph_clock_required');
  }
  const now = () => Number(typeof clock === 'function' ? clock() : clock.now());

  return Object.freeze({
    async upsertEntity({ entityId = randomUUID(), entityType, displayName, attributes = {} }) {
      if (typeof entityType !== 'string' || entityType.length === 0) throw new TypeError('graph_entity_type_required');
      if (typeof displayName !== 'string' || displayName.length === 0) throw new TypeError('graph_entity_display_name_required');
      return repository.putEntity({ entityId, entityType, displayName, attributes });
    },

    async proposeEdge({ fromEntityId, relationType, toEntityId, sourceRefs = [], confidence, classification }) {
      if (!(await repository.getEntity(fromEntityId))) throw new Error('graph_entity_not_found:from');
      if (!(await repository.getEntity(toEntityId))) throw new Error('graph_entity_not_found:to');
      if (!Array.isArray(sourceRefs) || sourceRefs.length === 0) throw new Error('graph_edge_source_refs_required');
      if (typeof confidence !== 'number' || confidence < 0 || confidence > 1) throw new TypeError('graph_edge_confidence_invalid');
      const edgeId = randomUUID();
      return repository.putEdge({
        edgeId, fromEntityId, relationType, toEntityId, sourceRefs, observedAt: now(), confidence, classification, status: 'proposed',
      });
    },

    async confirmEdge(edgeId) {
      const edge = await repository.getEdge(edgeId);
      if (!edge) throw new Error('graph_edge_not_found');
      return repository.updateEdgeStatus(edgeId, 'confirmed');
    },

    async disputeEdge(edgeId, reason) {
      const edge = await repository.getEdge(edgeId);
      if (!edge) throw new Error('graph_edge_not_found');
      if (typeof reason !== 'string' || reason.trim().length === 0) throw new Error('graph_edge_dispute_reason_required');
      return repository.updateEdgeStatus(edgeId, 'disputed', reason);
    },

    async forgetEntity(entityId) {
      if (!(await repository.getEntity(entityId))) throw new Error('graph_entity_not_found');
      await repository.deleteEntity(entityId);
      return Object.freeze({ entityId, forgotten: true });
    },

    async confirmedEdges() {
      return repository.listEdgesByStatus('confirmed');
    },

    async subgraph(query, policy) {
      const { startEntityId, maxDepth = 1 } = query ?? {};
      const { allowedClassifications, maxNodes = 50, maxEdges = 100 } = policy ?? {};
      if (!startEntityId) throw new TypeError('graph_subgraph_start_entity_required');
      if (!Array.isArray(allowedClassifications)) throw new TypeError('graph_subgraph_policy_required');

      const startEntity = await repository.getEntity(startEntityId);
      if (!startEntity) throw new Error('graph_entity_not_found');

      const nodes = new Map([[startEntityId, startEntity]]);
      const edges = new Map();
      let frontier = [startEntityId];

      for (let depth = 0; depth < maxDepth && frontier.length > 0; depth += 1) {
        const nextFrontier = [];
        for (const entityId of frontier) {
          if (edges.size >= maxEdges || nodes.size >= maxNodes) break;
          // eslint-disable-next-line no-await-in-loop
          const neighbors = await repository.listConfirmedNeighbors(entityId);
          for (const edge of neighbors) {
            if (!allowedClassifications.includes(edge.classification)) continue;
            if (edges.size >= maxEdges) break;
            edges.set(edge.edgeId, edge);
            const otherId = edge.fromEntityId === entityId ? edge.toEntityId : edge.fromEntityId;
            if (!nodes.has(otherId) && nodes.size < maxNodes) {
              // eslint-disable-next-line no-await-in-loop
              const otherEntity = await repository.getEntity(otherId);
              if (otherEntity) { nodes.set(otherId, otherEntity); nextFrontier.push(otherId); }
            }
          }
        }
        frontier = nextFrontier;
      }

      return Object.freeze({
        nodes: Object.freeze([...nodes.values()]),
        edges: Object.freeze([...edges.values()]),
      });
    },
  });
}

export { EDGE_STATUSES };
