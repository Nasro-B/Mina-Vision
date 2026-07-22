// Analyse d'impact d'un changement : combine le graphe de dépendances (fichiers affectés) et le
// call-graph (symboles appelants) pour estimer le rayon d'un correctif AVANT de l'appliquer.

const RISK_THRESHOLDS = Object.freeze({ moyen: 1, élevé: 4, critique: 10 });

export function createChangeImpactAnalyzer({ dependencyGraph, callGraph, symbolIndex } = {}) {
  if (!dependencyGraph || !callGraph || !symbolIndex) {
    throw new TypeError('change_impact_analyzer_dependencies_required');
  }

  return Object.freeze({
    analyze({ changedFile, changedSymbol } = {}) {
      if (typeof changedFile !== 'string' || changedFile.length === 0) {
        throw new Error('change_impact_changed_file_required');
      }
      const posix = changedFile.replace(/\\/gu, '/');
      const directDependents = dependencyGraph.dependents(posix);
      const transitiveDependents = dependencyGraph.affectedBy([posix]);

      let affectedSymbols = Object.freeze([]);
      if (changedSymbol) {
        const matches = symbolIndex.byName(changedSymbol, { exact: true })
          .filter((symbol) => symbol.file === posix);
        const callerIds = new Set();
        for (const symbol of matches) {
          for (const chain of callGraph.callers(symbol.id, 3)) {
            callerIds.add(chain[chain.length - 1]);
          }
        }
        affectedSymbols = Object.freeze([...callerIds]
          .map((id) => symbolIndex.get(id))
          .filter(Boolean));
      }

      const affectedTests = Object.freeze(transitiveDependents.filter((file) => file.includes('.test.')));
      const magnitude = transitiveDependents.length + affectedSymbols.length;
      const riskLevel = magnitude >= RISK_THRESHOLDS.critique ? 'critique'
        : magnitude >= RISK_THRESHOLDS.élevé ? 'élevé'
          : magnitude >= RISK_THRESHOLDS.moyen ? 'moyen'
            : 'faible';

      return Object.freeze({
        changedFile: posix,
        changedSymbol: changedSymbol ?? null,
        directDependents,
        transitiveDependents,
        affectedSymbols,
        affectedTests,
        riskLevel,
        summary: `${posix} : ${transitiveDependents.length} fichier(s) affecté(s), ${affectedTests.length} test(s), risque ${riskLevel}.`,
      });
    },
  });
}
