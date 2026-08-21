// Recherche T2.4 (SPEC agente-codage V2) : assemble les 3 modules recherche en UNE capacité que le
// code-orchestrator peut offrir AVANT de générer, quand il rencontre une inconnue (« quelle version de
// fastify ? ») — au lieu d'halluciner. Stratégie : le knowledge-cache D'ABORD (déjà appris, avec source
// et date), sinon on VÉRIFIE (registre / doc officielle) et on MÉMORISE. Le résultat entre comme évidence
// citée dans le tour suivant. Aucun nouveau moteur : c'est le code-orchestrator existant qui décide quand
// appeler. Injectable → testable sans réseau.

export function composeResearch({ registry, docFetcher, cache } = {}) {
  if (typeof registry?.npmPackage !== 'function' || typeof docFetcher?.fetchDoc !== 'function'
    || typeof cache?.recall !== 'function' || typeof cache?.remember !== 'function') {
    throw new TypeError('compose_research_dependencies_required');
  }

  return Object.freeze({
    // Version d'un paquet npm : cache d'abord, sinon registre + mémorisation (avec provenance).
    async packageVersion(name) {
      const key = `npm:${name}`;
      const known = cache.recall(key);
      if (known) return Object.freeze({ name, latest: known.value, source: known.source, date: known.date, fromCache: true });
      const result = await registry.npmPackage(name);
      if (result.latest) cache.remember(key, { value: result.latest, source: result.source });
      return Object.freeze({ ...result, fromCache: false });
    },

    // Documentation officielle → évidence marquée « Source non fiable » (déléguée au doc-fetcher).
    async doc(url) {
      return docFetcher.fetchDoc(url);
    },

    // « D'où tu sais ça ? » — réponse honnête (source + date, ou « je dois vérifier »).
    explain(key) {
      return cache.explain(key);
    },
  });
}
