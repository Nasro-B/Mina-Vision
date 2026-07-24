// Vérificateur de reçus d'automatisation : la dépendance `actionVerifier` de l'automation-runner.
// Après chaque invoke, il répond « l'effet attendu est-il PROUVÉ par le reçu ? ». Comparaison
// structurelle stricte : chaque clé de expectedEffect doit se retrouver, égale, dans receipt.effect.
// Pas de preuve → `confirmed:false` → le runner marque l'étape `unknown` et s'arrête (fail-honest),
// il ne continue jamais sur une simple promesse.

function subsetMatches(expected, actual) {
  if (expected == null) return true; // aucun effet exigé : le reçu suffit
  if (actual == null || typeof actual !== 'object') return false;
  for (const [key, value] of Object.entries(expected)) {
    if (value && typeof value === 'object') {
      if (!subsetMatches(value, actual[key])) return false;
    } else if (actual[key] !== value) {
      return false;
    }
  }
  return true;
}

export function createReceiptVerifier() {
  return Object.freeze({
    async verify({ action, receipt, expectedEffect } = {}) {
      if (!receipt?.receiptId || receipt.capability !== String(action?.capability ?? '')) {
        return Object.freeze({ confirmed: false, reason: 'recu_absent_ou_capability_differente' });
      }
      const confirmed = subsetMatches(expectedEffect ?? action?.expectedEffect ?? null, receipt.effect);
      return Object.freeze({
        confirmed,
        reason: confirmed ? null : 'effet_attendu_non_prouve',
        receiptId: receipt.receiptId,
        at: receipt.at,
      });
    },
  });
}
