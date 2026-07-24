import { createHomeAssistantConnector } from './adapters/home-assistant.mjs';

// Composition du domaine MAISON CONNECTÉE. Jusqu'ici le registre/service étaient composés avec des
// listes VIDES (devices:[], connectors:{}) : aucun appareil réel n'était jamais joignable. Ici on
// construit les connecteurs RÉELS à partir de la configuration, de façon FAIL-HONEST :
//   • Home Assistant : ne dépend que de fetch + WebSocket (ws) — constructible dès que l'URL locale
//     HTTPS et le jeton sont fournis.
//   • MQTT : la dépendance `mqtt` a été RETIRÉE du projet (R-16). Tant qu'elle n'est pas redéposée,
//     un broker configuré est signalé « indisponible », jamais faussement branché.
// Sans aucune configuration, le domaine reste « disabled » avec une raison claire — Config → Capacités
// affiche alors « maison connectée : aucun connecteur configuré », ce qui est la vérité.

export function composeHomeDomain({ env = process.env, fetchImpl, webSocketFactory } = {}) {
  const connectors = {};
  const notes = [];

  const haBaseUrl = env.HOME_ASSISTANT_BASE_URL?.trim();
  const haToken = env.HOME_ASSISTANT_TOKEN?.trim();
  if (haBaseUrl && haToken) {
    try {
      connectors['home-assistant'] = createHomeAssistantConnector({
        baseUrl: haBaseUrl,
        token: haToken,
        ...(fetchImpl ? { fetchImpl } : {}),
        ...(webSocketFactory ? { webSocketFactory } : {}),
      });
    } catch (error) {
      notes.push(`home_assistant_invalide:${String(error?.message ?? error).slice(0, 80)}`);
    }
  } else if (haBaseUrl || haToken) {
    notes.push('home_assistant_config_incomplete');
  }

  if (env.MQTT_BROKER_URL?.trim()) {
    // Configuré mais non branchable : la dépendance mqtt a été retirée (R-16). Honnête plutôt que faux.
    notes.push('mqtt_indisponible_dependance_retiree');
  }

  const count = Object.keys(connectors).length;
  const state = count > 0 ? 'configured' : 'disabled';
  const reason = count > 0
    ? (notes.length ? notes.join(' ; ') : null)
    : (notes.length ? notes.join(' ; ') : 'aucun_connecteur_configure');

  return Object.freeze({ connectors: Object.freeze(connectors), state, reason });
}
