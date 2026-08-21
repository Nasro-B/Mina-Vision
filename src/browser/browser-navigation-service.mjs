// Fast Path de navigation (SPEC-MINA-BROWSER-001 §8, Phase 4) — LE correctif de lenteur. Les commandes
// navigateur DÉTERMINISTES (navigate, open, search, back/forward/reload, new/close/focus tab) classées
// `route:'fast'` par browser-intent-router s'exécutent ICI, DIRECTEMENT via le driver, SANS boucle vision
// ni appel LLM. Avant, tout passait par l'unique boucle Computer Use (capture d'écran → modèle → clic) :
// « ouvre youtube » prenait des secondes. Ce service rend ces commandes quasi instantanées.
//
// Le driver est INJECTÉ (le vrai contrôle navigateur est branché au runtime) → module PUR/testable.
// Honnêteté §8.3 : `attempted` ≠ `verified`. Une navigation n'est annoncée réussie que si le driver
// PROUVE l'arrivée (readyState « complete » OU origine du resultUrl == origine cible). Sinon `attempted:
// true, verified:false` avec un errorCode — jamais de faux succès.

import { createBrowserActionResult } from './browser-contracts.mjs';

const FAST_TYPES = new Set(['open', 'navigate', 'search', 'back', 'forward', 'reload', 'new_tab', 'close_tab', 'focus_tab']);
const NO_URL_TYPES = new Set(['back', 'forward', 'reload', 'close_tab', 'focus_tab']); // pas d'URL à vérifier : succès = pas d'erreur
const DRIVER_METHODS = Object.freeze(['navigate', 'newTab', 'closeTab', 'back', 'forward', 'reload', 'open']);

function sameOrigin(a, b) {
  try { return new URL(a).origin === new URL(b).origin; } catch { return false; }
}

export function createBrowserNavigationService({ driver, now = () => Date.now() } = {}) {
  if (!driver || DRIVER_METHODS.some((method) => typeof driver[method] !== 'function')) {
    throw new TypeError('browser_navigation_service_driver_required');
  }

  function drive(command) {
    switch (command.type) {
      case 'navigate': return driver.navigate(command.targetUrl);
      case 'open': return command.targetUrl ? driver.navigate(command.targetUrl) : driver.open();
      case 'search': return driver.navigate(command.searchUrl); // routeBrowserCommand a déjà bâti l'URL du moteur
      case 'new_tab': return driver.newTab(command.targetUrl ?? null);
      case 'close_tab': return driver.closeTab();
      case 'focus_tab': return typeof driver.focusTab === 'function' ? driver.focusTab(command.tabId ?? null) : Promise.resolve({});
      case 'back': return driver.back();
      case 'forward': return driver.forward();
      case 'reload': return driver.reload();
      default: throw new Error('browser_navigation_service_unreachable');
    }
  }

  function expectedUrl(command) {
    if (command.type === 'navigate' || (command.type === 'open' && command.targetUrl)) return command.targetUrl;
    if (command.type === 'search') return command.searchUrl;
    if (command.type === 'new_tab') return command.targetUrl ?? null;
    return null;
  }

  return Object.freeze({
    canHandle: (command) => command?.route === 'fast' && FAST_TYPES.has(command?.type),

    async execute(command) {
      if (!command || command.route !== 'fast' || !FAST_TYPES.has(command.type)) {
        throw new Error('browser_navigation_service_not_fast');
      }
      const startedAt = now();
      let receipt;
      try {
        receipt = (await drive(command)) ?? {};
      } catch (error) {
        return createBrowserActionResult({
          commandId: command.commandId, route: 'fast', action: command.type, attempted: true, verified: false,
          errorCode: String(error?.message ?? 'fast_action_failed').slice(0, 80), timings: { totalMs: now() - startedAt },
        });
      }

      // Vérification honnête. Pour les ops sans URL (historique/onglets) ou sans cible (onglet vierge,
      // ouverture du navigateur), l'absence d'erreur suffit. Pour une navigation CIBLÉE, seule l'ORIGINE
      // du resultUrl fait foi : un readyState « complete » sur une page d'erreur/redirection n'est PAS un
      // succès (§8.3, jamais de faux succès) — on exige que le driver ait réellement atterri sur la cible.
      const target = expectedUrl(command);
      let verified;
      let reason;
      if (NO_URL_TYPES.has(command.type) || !target) {
        verified = true; reason = `${command.type}_effectue`;
      } else if (receipt.resultUrl && sameOrigin(receipt.resultUrl, target)) {
        verified = true; reason = 'origine_confirmee';
      } else {
        verified = false; reason = null;
      }

      return createBrowserActionResult({
        commandId: command.commandId, route: 'fast', action: command.type,
        attempted: true, verified, verificationReason: reason,
        pageId: receipt.pageId ?? null, navigationId: receipt.navigationId ?? null, resultUrl: receipt.resultUrl ?? null,
        errorCode: verified ? null : 'navigation_non_confirmee', timings: { totalMs: now() - startedAt },
      });
    },
  });
}
