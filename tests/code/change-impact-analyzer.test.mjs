import { describe, expect, it } from 'vitest';
import { createCallGraph } from '../../src/code/intelligence/call-graph.mjs';
import { createChangeImpactAnalyzer } from '../../src/code/intelligence/change-impact-analyzer.mjs';
import { createDependencyGraph } from '../../src/code/intelligence/dependency-graph.mjs';
import { createSymbolIndex } from '../../src/code/intelligence/symbol-index.mjs';

function buildAnalyzer() {
  const dependencyGraph = createDependencyGraph();
  const callGraph = createCallGraph();
  const symbolIndex = createSymbolIndex();
  dependencyGraph.setFile('src/service.mjs', ['src/lib.mjs']);
  dependencyGraph.setFile('src/app.mjs', ['src/service.mjs']);
  dependencyGraph.setFile('tests/service.test.mjs', ['src/service.mjs']);
  symbolIndex.addFile('src/lib.mjs', {
    symbols: [{ id: 'lib::aide', name: 'aide', kind: 'function', file: 'src/lib.mjs', visibility: 'exported' }],
  });
  symbolIndex.addFile('src/service.mjs', {
    symbols: [{ id: 'svc::servir', name: 'servir', kind: 'function', file: 'src/service.mjs', visibility: 'exported' }],
  });
  callGraph.addEdge({ callerId: 'svc::servir', calleeId: 'lib::aide' });
  return createChangeImpactAnalyzer({ dependencyGraph, callGraph, symbolIndex });
}

describe('change-impact-analyzer', () => {
  it('exige ses dépendances et un fichier changé', () => {
    expect(() => createChangeImpactAnalyzer({})).toThrow(/dependencies_required/u);
    expect(() => buildAnalyzer().analyze({})).toThrow(/changed_file_required/u);
  });

  it('remonte dépendants directs et transitifs + tests affectés', () => {
    const impact = buildAnalyzer().analyze({ changedFile: 'src/lib.mjs' });
    expect(impact.directDependents).toEqual(['src/service.mjs']);
    expect([...impact.transitiveDependents].sort()).toEqual(['src/app.mjs', 'src/service.mjs', 'tests/service.test.mjs']);
    expect(impact.affectedTests).toEqual(['tests/service.test.mjs']);
  });

  it('remonte les symboles appelants quand changedSymbol est fourni', () => {
    const impact = buildAnalyzer().analyze({ changedFile: 'src/lib.mjs', changedSymbol: 'aide' });
    expect(impact.affectedSymbols.map((symbol) => symbol.name)).toContain('servir');
  });

  it('gradue le risque selon l\'ampleur', () => {
    const analyzer = buildAnalyzer();
    expect(analyzer.analyze({ changedFile: 'src/app.mjs' }).riskLevel).toBe('faible');
    expect(analyzer.analyze({ changedFile: 'src/lib.mjs' }).riskLevel).toBe('moyen');

    const dependencyGraph = createDependencyGraph();
    for (let index = 0; index < 12; index += 1) dependencyGraph.setFile(`f${index}.mjs`, ['noyau.mjs']);
    const big = createChangeImpactAnalyzer({
      dependencyGraph,
      callGraph: createCallGraph(),
      symbolIndex: createSymbolIndex(),
    });
    expect(big.analyze({ changedFile: 'noyau.mjs' }).riskLevel).toBe('critique');
  });

  it('normalise les chemins Windows et produit un résumé lisible', () => {
    const impact = buildAnalyzer().analyze({ changedFile: 'src\\lib.mjs' });
    expect(impact.changedFile).toBe('src/lib.mjs');
    expect(impact.summary).toContain('src/lib.mjs');
    expect(impact.summary).toContain('risque');
    expect(Object.isFrozen(impact)).toBe(true);
  });
});
