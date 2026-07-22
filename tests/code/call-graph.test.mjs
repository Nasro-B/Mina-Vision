import { describe, expect, it } from 'vitest';
import { createCallGraph } from '../../src/code/intelligence/call-graph.mjs';

function buildGraph(edges) {
  const graph = createCallGraph();
  for (const [callerId, calleeId] of edges) graph.addEdge({ callerId, calleeId });
  return graph;
}

describe('call-graph', () => {
  it('rejette une arête invalide', () => {
    const graph = createCallGraph();
    expect(() => graph.addEdge({ callerId: '', calleeId: 'b' })).toThrow(/call_graph_edge_invalid/u);
    expect(() => graph.addEdge({ callerId: 'a' })).toThrow(/call_graph_edge_invalid/u);
  });

  it('callees à profondeur 1 puis transitive', () => {
    const graph = buildGraph([['a', 'b'], ['b', 'c'], ['c', 'd']]);
    expect(graph.callees('a', 1).map((chain) => chain[chain.length - 1])).toEqual(['b']);
    const deep = graph.callees('a', 3).map((chain) => chain[chain.length - 1]);
    expect(deep).toContain('c');
    expect(deep).toContain('d');
  });

  it('callers remonte la chaîne d\'appelants', () => {
    const graph = buildGraph([['a', 'c'], ['b', 'c'], ['racine', 'a']]);
    const direct = graph.callers('c', 1).map((chain) => chain[0]);
    expect(direct.sort()).toEqual(['a', 'b']);
    const transitive = graph.callers('c', 5).map((chain) => chain[chain.length - 1]);
    expect(transitive).toContain('racine');
  });

  it('shortestPath retourne le chemin BFS le plus court ou null', () => {
    const graph = buildGraph([['a', 'b'], ['b', 'c'], ['a', 'c'], ['x', 'y']]);
    expect(graph.shortestPath('a', 'c')).toEqual(['a', 'c']);
    expect(graph.shortestPath('a', 'a')).toEqual(['a']);
    expect(graph.shortestPath('a', 'y')).toBeNull();
  });

  it('findCycles détecte un cycle simple et ignore les graphes acycliques', () => {
    expect(buildGraph([['a', 'b'], ['b', 'c']]).findCycles()).toEqual([]);
    const cycles = buildGraph([['a', 'b'], ['b', 'a'], ['b', 'c']]).findCycles();
    expect(cycles).toHaveLength(1);
    expect(cycles[0]).toContain('a');
    expect(cycles[0]).toContain('b');
  });

  it('un cycle n\'est rapporté qu\'une fois', () => {
    const cycles = buildGraph([['a', 'b'], ['b', 'c'], ['c', 'a']]).findCycles();
    expect(cycles).toHaveLength(1);
  });

  it('les parcours survivent aux cycles sans boucle infinie', () => {
    const graph = buildGraph([['a', 'b'], ['b', 'a']]);
    expect(() => graph.callees('a', 10)).not.toThrow();
    expect(graph.callees('a', 10).length).toBeGreaterThan(0);
  });

  it('toDot produit un digraph filtrable par symbole', () => {
    const graph = buildGraph([['a', 'b'], ['c', 'd']]);
    const full = graph.toDot();
    expect(full).toContain('"a" -> "b";');
    expect(full).toContain('"c" -> "d";');
    const focused = graph.toDot({ focusSymbolId: 'a' });
    expect(focused).toContain('"a" -> "b";');
    expect(focused).not.toContain('"c" -> "d";');
  });

  it('stats compte nœuds et arêtes', () => {
    const graph = buildGraph([['a', 'b'], ['b', 'c']]);
    expect(graph.stats()).toEqual({ nodes: 3, edges: 2 });
  });

  it('les résultats sont gelés', () => {
    const graph = buildGraph([['a', 'b']]);
    expect(Object.isFrozen(graph.callees('a', 1))).toBe(true);
    expect(Object.isFrozen(graph.findCycles())).toBe(true);
  });
});
