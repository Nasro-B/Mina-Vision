import { classifyBrowserUtterance, routeBrowserCommand } from './browser-intent-router.mjs';
import { createBrowserReconciliation } from './browser-reconciler.mjs';
import { createBrowserPerformanceTracer } from '../diagnostics/browser-performance-tracer.mjs';

// Composition du domaine NAVIGATION navigateur (SPEC-MINA-BROWSER-001). Assemble le routeur
// déterministe (classify/route), le réconciliateur par commande et le traceur de performance en UN
// domaine cohérent — l'analogue de compose-communications-domain. DORMANT : il ne pilote aucun
// navigateur et ne s'insère PAS dans le flux voix/mission (l'activation du Fast Path reste gatée par
// la baseline Phase 0 = LM Studio, exclu). Il fournit un point d'entrée unique + un traceur partagé,
// prêt pour quand le câblage sera décidé. Module PUR, sans état sauf le ring borné du traceur.

export function composeBrowserNavigationDomain({ maxSpans = 2_000, now = () => Date.now() } = {}) {
  const tracer = createBrowserPerformanceTracer({ maxSpans, now });

  return Object.freeze({
    // Classement déterministe (zéro LLM) : renvoie la nature de l'énoncé, ou null si non-navigateur.
    classify: (utterance) => classifyBrowserUtterance(utterance),

    // Commande normalisée + voie ('fast'/'semantic'/…) ; une recherche porte son searchUrl encodé.
    route: (utterance, options = {}) => routeBrowserCommand(utterance, options),

    // Réconciliation par commande (deadline + budget de récupération portés par la machine d'état).
    beginReconciliation: (options = {}) => createBrowserReconciliation({ now, ...options }),

    tracer,

    // État d'observabilité (§8.4) : uniquement des nombres par phase, jamais d'URL/requête/DOM.
    status: () => Object.freeze({ spans: tracer.size(), byPhase: tracer.byPhase() }),
  });
}
