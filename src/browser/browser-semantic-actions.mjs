// Actions sémantiques (SPEC-MINA-BROWSER-001 §8, Phase 5) — route `semantic`. Agit sur le DOM par
// LOCATORS (rôle ARIA, libellé), pas par coordonnées de vision : « clique sur Connexion », « écris X
// dans le champ Email ». Bien plus rapide et robuste que la boucle vision (capture → modèle → clic aux
// pixels), et insensible au déplacement d'un bouton d'un pixel.
//
// Driver DOM INJECTÉ (le vrai accès page est branché au runtime) → module PUR/testable. Honnêteté §8.3 :
// `attempted` ≠ `verified`. Un remplissage n'est « vérifié » que si la RELECTURE de la valeur confirme
// la saisie ; `fillAndSubmit` est ATOMIQUE : il ne soumet JAMAIS un formulaire dont le remplissage n'a
// pas été confirmé (évite d'envoyer un champ vide/mal saisi). Élément introuvable → échec net, jamais
// un clic « au hasard » (aucune supposition destructive).

import { createBrowserActionResult } from './browser-contracts.mjs';

const DRIVER_METHODS = Object.freeze(['locate', 'click', 'fill', 'readValue']);

function result(command, over) {
  return createBrowserActionResult({ commandId: command?.commandId ?? null, route: 'semantic', ...over });
}

export function createBrowserSemanticActions({ driver, now = () => Date.now() } = {}) {
  if (!driver || DRIVER_METHODS.some((method) => typeof driver[method] !== 'function')) {
    throw new TypeError('browser_semantic_actions_driver_required');
  }

  async function locateOrFail(descriptor) {
    const handle = await driver.locate(descriptor);
    if (!handle) return null;
    return handle;
  }

  const api = {
    async clickByRole({ role, name, commandId } = {}) {
      const command = { commandId };
      const handle = await locateOrFail({ by: 'role', role, name });
      if (!handle) return result(command, { action: 'click', attempted: false, verified: false, errorCode: 'element_introuvable' });
      try {
        const receipt = (await driver.click(handle)) ?? {};
        // On PROUVE seulement ce qu'on peut : l'élément a été localisé par son rôle/nom et le clic a été
        // distribué dessus. L'EFFET (navigation, ouverture) est vérifié en aval par le réconciliateur.
        return result(command, {
          action: 'click', attempted: true, verified: true, verificationReason: 'clic_sur_element_localise',
          resultUrl: receipt.resultUrl ?? null, navigationId: receipt.navigationId ?? null,
        });
      } catch (error) {
        return result(command, { action: 'click', attempted: true, verified: false, errorCode: String(error?.message ?? 'clic_echec').slice(0, 80) });
      }
    },

    async fillByLabel({ label, value, commandId } = {}) {
      const command = { commandId };
      const handle = await locateOrFail({ by: 'label', label });
      if (!handle) return result(command, { action: 'fill', attempted: false, verified: false, errorCode: 'champ_introuvable' });
      try {
        await driver.fill(handle, String(value ?? ''));
        const readback = String((await driver.readValue(handle)) ?? '');
        const ok = readback === String(value ?? '');
        return result(command, {
          action: 'fill', attempted: true, verified: ok,
          verificationReason: ok ? 'valeur_relue_confirmee' : null,
          errorCode: ok ? null : 'remplissage_non_confirme',
        });
      } catch (error) {
        return result(command, { action: 'fill', attempted: true, verified: false, errorCode: String(error?.message ?? 'remplissage_echec').slice(0, 80) });
      }
    },

    // ATOMIQUE : remplit, VÉRIFIE la relecture, et ne soumet QUE si le remplissage est confirmé.
    async fillAndSubmit({ label, value, submitRole = 'button', submitName, commandId } = {}) {
      const filled = await api.fillByLabel({ label, value, commandId });
      if (!filled.verified) return { ...filled, action: 'fill_submit' }; // remplissage non confirmé → jamais de soumission
      const submitHandle = await locateOrFail({ by: 'role', role: submitRole, name: submitName });
      if (!submitHandle) return result({ commandId }, { action: 'fill_submit', attempted: true, verified: false, errorCode: 'bouton_soumission_introuvable' });
      try {
        const receipt = (await driver.click(submitHandle)) ?? {};
        return result({ commandId }, {
          action: 'fill_submit', attempted: true, verified: true, verificationReason: 'rempli_puis_soumis',
          resultUrl: receipt.resultUrl ?? null, navigationId: receipt.navigationId ?? null,
        });
      } catch (error) {
        return result({ commandId }, { action: 'fill_submit', attempted: true, verified: false, errorCode: String(error?.message ?? 'soumission_echec').slice(0, 80) });
      }
    },
  };

  return Object.freeze(api);
}
