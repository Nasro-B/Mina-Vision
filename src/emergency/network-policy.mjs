// Politique réseau du mode urgence : la dépendance `network_policy` attendue par emergency-mode.
// Coupe et rétablit des PORTES RÉELLES injectées (boucle de sync téléphone, canal chat, recherche
// web…) — chaque porte est {id, disable(), restore()} branchée sur le vrai runtime dans main.mjs.
// Une porte qui refuse de se couper N'EST PAS ignorée : l'activation échoue (fail-loud) plutôt
// que d'annoncer un mode urgence à moitié coupé.

export function createNetworkPolicy({ gates = [], logger = null } = {}) {
  for (const gate of gates) {
    if (!gate?.id || typeof gate.disable !== 'function' || typeof gate.restore !== 'function') {
      throw new TypeError('network_policy_gate_invalid');
    }
  }
  let disabled = false;

  return Object.freeze({
    async disableAll() {
      for (const gate of gates) {
        await gate.disable();
        logger?.append?.({ event: 'urgence_porte_coupee', gate: gate.id });
      }
      disabled = true;
      return Object.freeze({ disabled: true, gates: gates.map((gate) => gate.id) });
    },
    async restore() {
      // Rétablissement best-effort dans l'ordre inverse : une porte qui échoue est journalisée
      // mais n'empêche pas les autres de revivre — rester coincé en urgence serait pire.
      for (const gate of [...gates].reverse()) {
        try {
          await gate.restore();
          logger?.append?.({ event: 'urgence_porte_retablie', gate: gate.id });
        } catch (error) {
          logger?.append?.({ event: 'urgence_porte_retablissement_echec', gate: gate.id, error: String(error?.message ?? error).slice(0, 120) });
        }
      }
      disabled = false;
      return Object.freeze({ disabled: false });
    },
    isDisabled: () => disabled,
  });
}
