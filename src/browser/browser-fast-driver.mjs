// Adaptateur : expose le contrôle de page Playwright (via browser-executor) sous la forme du DRIVER
// attendu par browser-navigation-service (Fast Path). Découplé de l'exécuteur : il ne dépend que de deux
// fonctions INJECTÉES — `run(action)` (déclenche navigate/go_back/go_forward/reload/new_tab/close_tab sur
// la vraie page) et `currentUrl()` (renvoie page.url() APRÈS l'action, pour la vérification par origine du
// Fast Path). main.mjs branche les vraies méthodes de l'exécuteur ; ici tout est pur/testable.
//
// Aucune vision, aucun LLM : c'est le chemin rapide. Le receipt renvoyé porte `resultUrl` (pour la preuve
// d'arrivée §8.3) ; l'exécuteur reste seul maître des actions autorisées (le driver ne fabrique jamais
// d'action hors de la liste blanche de l'exécuteur).

const AFTER_NAV_TYPES = Object.freeze(['navigate', 'go_back', 'go_forward', 'reload', 'new_tab']);

export function createBrowserFastDriver({ run, currentUrl } = {}) {
  if (typeof run !== 'function' || typeof currentUrl !== 'function') {
    throw new TypeError('browser_fast_driver_dependencies_required');
  }

  const runThen = async (action) => {
    await run(action);
    // resultUrl seulement pour les actions qui aboutissent à une URL vérifiable.
    if (AFTER_NAV_TYPES.includes(action.name)) {
      return Object.freeze({ resultUrl: await currentUrl(), readyState: 'complete' });
    }
    return Object.freeze({});
  };

  return Object.freeze({
    navigate: (url) => runThen({ name: 'navigate', url }),
    open: () => runThen({ name: 'navigate', url: 'about:blank' }),
    back: () => runThen({ name: 'go_back' }),
    forward: () => runThen({ name: 'go_forward' }),
    reload: () => runThen({ name: 'reload' }),
    newTab: (url) => runThen({ name: 'new_tab', url: url ?? 'about:blank' }),
    closeTab: () => runThen({ name: 'close_tab' }),
  });
}
