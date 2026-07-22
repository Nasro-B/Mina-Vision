import { describe, expect, it } from 'vitest';
import { createDependencyGraph } from '../../src/code/intelligence/dependency-graph.mjs';

function buildGraph(spec) {
  const graph = createDependencyGraph();
  for (const [file, deps] of Object.entries(spec)) graph.setFile(file, deps);
  return graph;
}

describe('dependency-graph', () => {
  it('valide le chemin et ignore l\'auto-dépendance', () => {
    const graph = createDependencyGraph();
    expect(() => graph.setFile('')).toThrow(/dependency_graph_file_required/u);
    graph.setFile('a.mjs', ['a.mjs', 'b.mjs']);
    expect(graph.directDependencies('a.mjs')).toEqual(['b.mjs']);
  });

  it('dépendances directes et transitives', () => {
    const graph = buildGraph({ 'a.mjs': ['b.mjs'], 'b.mjs': ['c.mjs'], 'c.mjs': [] });
    expect(graph.directDependencies('a.mjs')).toEqual(['b.mjs']);
    expect([...graph.transitiveDependencies('a.mjs')].sort()).toEqual(['b.mjs', 'c.mjs']);
  });

  it('dependents = qui m\'importe directement', () => {
    const graph = buildGraph({ 'a.mjs': ['lib.mjs'], 'b.mjs': ['lib.mjs'] });
    expect([...graph.dependents('lib.mjs')].sort()).toEqual(['a.mjs', 'b.mjs']);
  });

  it('affectedBy remonte transitivement sans inclure les fichiers changés eux-mêmes', () => {
    const graph = buildGraph({ 'app.mjs': ['service.mjs'], 'service.mjs': ['lib.mjs'], 'autre.mjs': [] });
    const affected = graph.affectedBy(['lib.mjs']);
    expect([...affected].sort()).toEqual(['app.mjs', 'service.mjs']);
    expect(() => graph.affectedBy('lib.mjs')).toThrow(/changed_files_required/u);
  });

  it('topologicalSort place les dépendances avant leurs dépendants', () => {
    const graph = buildGraph({ 'app.mjs': ['service.mjs'], 'service.mjs': ['lib.mjs'], 'lib.mjs': [] });
    const order = graph.topologicalSort();
    expect(order.indexOf('lib.mjs')).toBeLessThan(order.indexOf('service.mjs'));
    expect(order.indexOf('service.mjs')).toBeLessThan(order.indexOf('app.mjs'));
  });

  it('topologicalSort tolère les cycles (fichiers du cycle ajoutés en fin, jamais perdus)', () => {
    const graph = buildGraph({ 'a.mjs': ['b.mjs'], 'b.mjs': ['a.mjs'], 'c.mjs': [] });
    const order = graph.topologicalSort();
    expect(order).toHaveLength(3);
    expect(order).toContain('a.mjs');
    expect(order).toContain('b.mjs');
  });

  it('findCircularImports détecte et déduplique les cycles', () => {
    expect(buildGraph({ 'a.mjs': ['b.mjs'], 'b.mjs': [] }).findCircularImports()).toEqual([]);
    const cycles = buildGraph({ 'a.mjs': ['b.mjs'], 'b.mjs': ['c.mjs'], 'c.mjs': ['a.mjs'] }).findCircularImports();
    expect(cycles).toHaveLength(1);
    expect(cycles[0]).toContain('a.mjs');
  });

  it('réindexer un fichier remplace ses dépendances proprement', () => {
    const graph = buildGraph({ 'a.mjs': ['vieux.mjs'] });
    graph.setFile('a.mjs', ['neuf.mjs']);
    expect(graph.dependents('vieux.mjs')).toEqual([]);
    expect(graph.dependents('neuf.mjs')).toEqual(['a.mjs']);
  });

  it('removeFile purge les deux sens', () => {
    const graph = buildGraph({ 'a.mjs': ['lib.mjs'] });
    graph.removeFile('a.mjs');
    expect(graph.dependents('lib.mjs')).toEqual([]);
    expect(graph.directDependencies('a.mjs')).toEqual([]);
  });

  it('stats compte fichiers et arêtes', () => {
    const graph = buildGraph({ 'a.mjs': ['b.mjs', 'c.mjs'] });
    expect(graph.stats()).toEqual({ files: 3, edges: 2 });
  });
});
