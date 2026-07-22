import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyPersonalGraphMigrations, createGraphRepository } from '../src/graph/graph-repository.mjs';
import { createPersonalGraph } from '../src/graph/personal-graph.mjs';
import { createEntityResolver } from '../src/graph/entity-resolver.mjs';

let db;
let directory;
let repository;
let graph;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'mina-personal-graph-'));
  db = new Database(join(directory, 'personal-graph.sqlite'));
  applyPersonalGraphMigrations(db);
  repository = createGraphRepository({ db, clock: () => 1_700_000_000_000 });
  graph = createPersonalGraph({ repository, clock: () => 1_700_000_000_000 });
});

afterEach(async () => {
  if (db?.open) db.close();
  await rm(directory, { recursive: true, force: true });
});

describe('applyPersonalGraphMigrations', () => {
  it('is idempotent', () => {
    expect(() => applyPersonalGraphMigrations(db)).not.toThrow();
  });
});

describe('createPersonalGraph.upsertEntity', () => {
  it('creates an entity with a generated id when none is given', async () => {
    const entity = await graph.upsertEntity({ entityType: 'person', displayName: 'Alice', attributes: { email: 'alice@example.com' } });
    expect(typeof entity.entityId).toBe('string');
    expect(entity.attributes).toEqual({ email: 'alice@example.com' });
  });

  it('updates an existing entity when entityId is given again', async () => {
    const first = await graph.upsertEntity({ entityType: 'person', displayName: 'Alice' });
    const updated = await graph.upsertEntity({ entityId: first.entityId, entityType: 'person', displayName: 'Alice B.' });
    expect(updated.displayName).toBe('Alice B.');
    expect((await repository.listEntities())).toHaveLength(1);
  });
});

describe('createPersonalGraph.proposeEdge: exact shape from the plan', () => {
  it('creates a proposed edge with the documented fields', async () => {
    const a = await graph.upsertEntity({ entityType: 'person', displayName: 'Alice' });
    const b = await graph.upsertEntity({ entityType: 'person', displayName: 'Bob' });
    const edge = await graph.proposeEdge({
      fromEntityId: a.entityId, relationType: 'knows', toEntityId: b.entityId,
      sourceRefs: ['mail:m1'], confidence: 0.7, classification: 'personal',
    });
    expect(edge).toMatchObject({
      fromEntityId: a.entityId, relationType: 'knows', toEntityId: b.entityId,
      sourceRefs: ['mail:m1'], confidence: 0.7, classification: 'personal', status: 'proposed',
    });
    expect(typeof edge.edgeId).toBe('string');
    expect(typeof edge.observedAt).toBe('number');
  });

  it('rejects an edge referencing an unknown entity', async () => {
    const a = await graph.upsertEntity({ entityType: 'person', displayName: 'Alice' });
    await expect(graph.proposeEdge({ fromEntityId: a.entityId, relationType: 'knows', toEntityId: 'missing', sourceRefs: ['mail:m1'], confidence: 0.5, classification: 'personal' }))
      .rejects.toThrow('graph_entity_not_found:to');
  });

  it('rejects an edge with no source references (never an unsourced claim)', async () => {
    const a = await graph.upsertEntity({ entityType: 'person', displayName: 'Alice' });
    const b = await graph.upsertEntity({ entityType: 'person', displayName: 'Bob' });
    await expect(graph.proposeEdge({ fromEntityId: a.entityId, relationType: 'knows', toEntityId: b.entityId, sourceRefs: [], confidence: 0.5, classification: 'personal' }))
      .rejects.toThrow('graph_edge_source_refs_required');
  });
});

describe('createPersonalGraph.confirmEdge / disputeEdge / confirmedEdges', () => {
  async function proposedEdge() {
    const a = await graph.upsertEntity({ entityType: 'person', displayName: 'Alice' });
    const b = await graph.upsertEntity({ entityType: 'person', displayName: 'Bob' });
    return graph.proposeEdge({ fromEntityId: a.entityId, relationType: 'knows', toEntityId: b.entityId, sourceRefs: ['mail:m1'], confidence: 0.7, classification: 'personal' });
  }

  it('resolve: ambiguous name never produces a confirmed edge on its own', async () => {
    await graph.upsertEntity({ entityType: 'person', displayName: 'Mohamed', attributes: { name: 'Mohamed' } });
    const resolver = createEntityResolver({ repository });
    const result = await resolver.resolve({ name: 'Mohamed', email: null });
    expect(result.status).toBe('ambiguous');
    expect(await graph.confirmedEdges()).toHaveLength(0);
  });

  it('confirmEdge moves a proposed edge to confirmed, visible via confirmedEdges', async () => {
    const edge = await proposedEdge();
    await graph.confirmEdge(edge.edgeId);
    const confirmed = await graph.confirmedEdges();
    expect(confirmed.map((e) => e.edgeId)).toContain(edge.edgeId);
  });

  it('disputeEdge requires a non-empty reason and keeps the edge (never deletes it)', async () => {
    const edge = await proposedEdge();
    await expect(graph.disputeEdge(edge.edgeId, '')).rejects.toThrow('graph_edge_dispute_reason_required');
    const disputed = await graph.disputeEdge(edge.edgeId, 'Confusion avec un homonyme');
    expect(disputed).toMatchObject({ status: 'disputed', disputeReason: 'Confusion avec un homonyme' });
    expect(await repository.getEdge(edge.edgeId)).not.toBeNull();
  });

  it('rejects confirming/disputing an unknown edge', async () => {
    await expect(graph.confirmEdge('missing')).rejects.toThrow('graph_edge_not_found');
    await expect(graph.disputeEdge('missing', 'x')).rejects.toThrow('graph_edge_not_found');
  });
});

describe('createPersonalGraph.forgetEntity', () => {
  it('removes the entity and its edges entirely', async () => {
    const a = await graph.upsertEntity({ entityType: 'person', displayName: 'Alice' });
    const b = await graph.upsertEntity({ entityType: 'person', displayName: 'Bob' });
    const edge = await graph.proposeEdge({ fromEntityId: a.entityId, relationType: 'knows', toEntityId: b.entityId, sourceRefs: ['mail:m1'], confidence: 0.5, classification: 'personal' });
    await graph.forgetEntity(a.entityId);
    expect(await repository.getEntity(a.entityId)).toBeNull();
    expect(await repository.getEdge(edge.edgeId)).toBeNull();
  });

  it('rejects forgetting an unknown entity', async () => {
    await expect(graph.forgetEntity('missing')).rejects.toThrow('graph_entity_not_found');
  });
});

describe('createPersonalGraph.subgraph: never the whole graph, always policy-bounded', () => {
  async function threeHopGraph() {
    const a = await graph.upsertEntity({ entityType: 'person', displayName: 'Alice' });
    const b = await graph.upsertEntity({ entityType: 'person', displayName: 'Bob' });
    const c = await graph.upsertEntity({ entityType: 'person', displayName: 'Carol' });
    const secret = await graph.upsertEntity({ entityType: 'person', displayName: 'Secret' });
    const ab = await graph.proposeEdge({ fromEntityId: a.entityId, relationType: 'knows', toEntityId: b.entityId, sourceRefs: ['mail:m1'], confidence: 0.8, classification: 'personal' });
    const bc = await graph.proposeEdge({ fromEntityId: b.entityId, relationType: 'knows', toEntityId: c.entityId, sourceRefs: ['mail:m2'], confidence: 0.8, classification: 'personal' });
    const asecret = await graph.proposeEdge({ fromEntityId: a.entityId, relationType: 'knows', toEntityId: secret.entityId, sourceRefs: ['mail:m3'], confidence: 0.8, classification: 'sensitive' });
    await graph.confirmEdge(ab.edgeId);
    await graph.confirmEdge(bc.edgeId);
    await graph.confirmEdge(asecret.edgeId);
    return { a, b, c, secret };
  }

  it('never includes an edge whose classification is outside the policy allowlist', async () => {
    const { a } = await threeHopGraph();
    const result = await graph.subgraph({ startEntityId: a.entityId, maxDepth: 2 }, { allowedClassifications: ['personal'], maxNodes: 50, maxEdges: 50 });
    expect(result.nodes.map((n) => n.displayName)).not.toContain('Secret');
    expect(result.edges.every((e) => e.classification === 'personal')).toBe(true);
  });

  it('never exceeds maxNodes/maxEdges even if the graph has more', async () => {
    const { a } = await threeHopGraph();
    const result = await graph.subgraph({ startEntityId: a.entityId, maxDepth: 2 }, { allowedClassifications: ['personal', 'sensitive'], maxNodes: 2, maxEdges: 1 });
    expect(result.nodes.length).toBeLessThanOrEqual(2);
    expect(result.edges.length).toBeLessThanOrEqual(1);
  });

  it('only traverses confirmed edges, never proposed or disputed ones', async () => {
    const a = await graph.upsertEntity({ entityType: 'person', displayName: 'Alice' });
    const b = await graph.upsertEntity({ entityType: 'person', displayName: 'Bob' });
    await graph.proposeEdge({ fromEntityId: a.entityId, relationType: 'knows', toEntityId: b.entityId, sourceRefs: ['mail:m1'], confidence: 0.5, classification: 'personal' });
    const result = await graph.subgraph({ startEntityId: a.entityId, maxDepth: 2 }, { allowedClassifications: ['personal'], maxNodes: 50, maxEdges: 50 });
    expect(result.nodes).toHaveLength(1);
    expect(result.edges).toHaveLength(0);
  });

  it('rejects a policy without an explicit allowedClassifications allowlist', async () => {
    const { a } = await threeHopGraph();
    await expect(graph.subgraph({ startEntityId: a.entityId }, {})).rejects.toThrow('graph_subgraph_policy_required');
  });

  it('rejects an unknown startEntityId', async () => {
    await expect(graph.subgraph({ startEntityId: 'missing' }, { allowedClassifications: ['personal'] })).rejects.toThrow('graph_entity_not_found');
  });
});
