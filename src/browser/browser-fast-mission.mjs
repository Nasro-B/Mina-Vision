// Pré-filtre Fast Path au POINT D'ENTRÉE mission (SPEC-MINA-BROWSER-001, câblage). Avant de lancer la
// boucle Computer Use (lente, vision), on tente d'exécuter la commande en Fast Path si — et seulement si —
// elle est déterministe ET dans le sous-ensemble réellement supporté par l'exécuteur navigateur
// (navigate / search / back / forward ; les handlers `navigate`/`go_back`/`go_forward` existent). Tout le
// reste (nouvel onglet, fermeture, reload, action sémantique, vision, ambiguïté) RETOMBE proprement sur la
// voie normale : `handled:false`. Ne casse donc jamais un cas non couvert — il ne le RÉCLAME pas.
//
// PUR / injectable (`service` = browser-navigation-service, `route` = routeBrowserCommand) → testable sans
// navigateur. C'est ce module que main.mjs appelle en tête de startMission, DERRIÈRE un flag off par défaut.

const FAST_HANDLED_TYPES = new Set(['navigate', 'search', 'back', 'forward']);

export function createBrowserFastMission({ service, route } = {}) {
  if (typeof service?.execute !== 'function' || typeof route !== 'function') {
    throw new TypeError('browser_fast_mission_dependencies_required');
  }

  return Object.freeze({
    // Renvoie { handled:false } → laisser la voie normale ; { handled:true, command, result } → Fast Path fait.
    async tryHandle({ goal, commandId, requestedAt = 0 } = {}) {
      const command = route(goal, { commandId, source: 'mission', requestedAt });
      if (!command || command.ambiguous || command.route !== 'fast' || !FAST_HANDLED_TYPES.has(command.type)) {
        return Object.freeze({ handled: false });
      }
      const result = await service.execute(command);
      return Object.freeze({ handled: true, command, result });
    },
  });
}
