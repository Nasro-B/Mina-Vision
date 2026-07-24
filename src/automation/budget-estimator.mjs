// Estimateur de budget des automatisations : la dépendance `budget_estimator` attendue par la
// simulation. Estimation DÉTERMINISTE et majorante par table de coûts par préfixe de capability —
// jamais un chiffre inventé par un modèle. Le but : montrer à Nasro un ordre de grandeur honnête
// AVANT d'autoriser, et permettre à la politique de refuser ce qui dépasse un plafond.

const DEFAULT_RATES = Object.freeze({
  // coût par action, en unités concrètes : durée majorée, tokens LLM éventuels, micro-euros.
  notify: Object.freeze({ durationMs: 500, tokens: 0, costMicros: 0 }),
  journal: Object.freeze({ durationMs: 50, tokens: 0, costMicros: 0 }),
  memory: Object.freeze({ durationMs: 200, tokens: 0, costMicros: 0 }),
  document: Object.freeze({ durationMs: 3_000, tokens: 0, costMicros: 0 }),
  telegram: Object.freeze({ durationMs: 2_000, tokens: 0, costMicros: 0 }),
  home: Object.freeze({ durationMs: 1_500, tokens: 0, costMicros: 0 }),
  llm: Object.freeze({ durationMs: 8_000, tokens: 2_000, costMicros: 2_000 }),
});

const FALLBACK_RATE = Object.freeze({ durationMs: 5_000, tokens: 0, costMicros: 0 });

export function createBudgetEstimator({ rates = DEFAULT_RATES } = {}) {
  return async function estimate(actions = []) {
    let durationMs = 0;
    let tokens = 0;
    let costMicros = 0;
    let unknownRates = 0;
    for (const action of actions) {
      const prefix = String(action?.capability ?? '').split(':')[0];
      const rate = rates[prefix] ?? FALLBACK_RATE;
      if (!rates[prefix]) unknownRates += 1;
      durationMs += rate.durationMs;
      tokens += rate.tokens;
      costMicros += rate.costMicros;
    }
    return Object.freeze({
      actionCount: actions.length,
      estimatedDurationMs: durationMs,
      estimatedTokens: tokens,
      estimatedCostMicros: costMicros,
      // Capabilities sans tarif connu : compté et visible — l'estimation reste majorante mais on
      // ne cache pas qu'elle repose sur un tarif générique.
      unknownRates,
    });
  };
}

export { DEFAULT_RATES };
