// Routeur de fournisseurs code : choisit le provider « code.generate » selon le mode, la
// disponibilité RÉELLE (health du registry) et les prix RÉELS du pricing-catalog (lignes
// vérifiées avec source datée — aucune ligne inventée). Les providers locaux coûtent 0.

const MODES = new Set(['auto', 'local-first', 'local-only', 'best-quality', 'cheapest']);

// Classement qualité par défaut, surchageable — préfixes d'id de provider, du meilleur au moindre.
const DEFAULT_QUALITY_ORDER = Object.freeze([
  'openai-compatible', // OpenRouter (Claude & co)
  'deepseek',
  'gemini',
  'lm-studio',
]);

export function createCodeProviderRouter({
  providerRegistry,
  pricingRows = [],
  qualityOrder = DEFAULT_QUALITY_ORDER,
  defaultMode = 'auto',
} = {}) {
  if (!providerRegistry || typeof providerRegistry.list !== 'function') {
    throw new TypeError('code_provider_router_registry_required');
  }
  let currentMode = MODES.has(defaultMode) ? defaultMode : 'auto';

  function priceFor(providerId, modelId) {
    // provider adapté « deepseek-code » → prix du provider de base « deepseek ».
    const baseId = providerId.replace(/-code$/u, '');
    const row = pricingRows.find((entry) => entry.providerId === baseId && entry.modelId === modelId)
      ?? pricingRows.find((entry) => entry.providerId === baseId);
    if (!row) return null;
    const input = Number(row.unitPrices?.inputTokensPerMillion ?? NaN);
    const output = Number(row.unitPrices?.outputTokensPerMillion ?? NaN);
    if (!Number.isFinite(input) || !Number.isFinite(output)) return null;
    return Object.freeze({ inputPerMillion: input, outputPerMillion: output, combined: input + output, revision: row.revision });
  }

  function candidates() {
    return providerRegistry.list()
      .filter((provider) => provider.capabilities.includes('code.generate'))
      .filter((provider) => provider.health?.available === true)
      .map((provider) => {
        const pricing = provider.locality === 'local'
          ? Object.freeze({ inputPerMillion: 0, outputPerMillion: 0, combined: 0, revision: 'local-gratuit' })
          : priceFor(provider.id, provider.modelId);
        return Object.freeze({ ...provider, pricing });
      });
  }

  const qualityRank = (provider) => {
    const index = qualityOrder.findIndex((prefix) => provider.id.startsWith(prefix));
    return index === -1 ? qualityOrder.length : index;
  };

  const cheapest = (list) => [...list].sort((a, b) => {
    const priceA = a.pricing?.combined ?? Number.POSITIVE_INFINITY;
    const priceB = b.pricing?.combined ?? Number.POSITIVE_INFINITY;
    return priceA - priceB || qualityRank(a) - qualityRank(b);
  })[0] ?? null;

  function pick(mode, { complexity = 'normal' } = {}) {
    const available = candidates();
    const locals = available.filter((provider) => provider.locality === 'local');
    const clouds = available.filter((provider) => provider.locality === 'cloud');

    switch (mode) {
      case 'local-only':
        return locals[0] ?? null;
      case 'local-first':
        return locals[0] ?? cheapest(clouds);
      case 'cheapest':
        return cheapest(available);
      case 'best-quality':
        return [...available].sort((a, b) => qualityRank(a) - qualityRank(b))[0] ?? null;
      case 'auto':
      default:
        // Local si disponible ET tâche non complexe ; sinon le cloud le moins cher.
        if (locals.length > 0 && complexity !== 'high') return locals[0];
        return cheapest(clouds) ?? locals[0] ?? null;
    }
  }

  return Object.freeze({
    getMode: () => currentMode,

    setMode(mode) {
      if (!MODES.has(mode)) throw new Error(`code_provider_router_mode_invalid: ${mode}`);
      currentMode = mode;
      return currentMode;
    },

    listCandidates: candidates,

    route({ task, mode, context, maxBudget } = {}) {
      void task;
      const effectiveMode = mode && MODES.has(mode) ? mode : currentMode;
      const chosen = pick(effectiveMode, { complexity: context?.complexity });
      if (!chosen) {
        throw new Error(effectiveMode === 'local-only'
          ? 'code_provider_route_unavailable_offline: aucun provider code local disponible'
          : 'code_provider_route_unavailable: aucun provider code disponible');
      }
      // Fail-closed budgétaire : sous plafond, un prix INCONNU vaut dépassement.
      if (Number.isFinite(maxBudget) && (chosen.pricing === null || chosen.pricing.combined > maxBudget)) {
        const affordable = candidates().filter((provider) => (provider.pricing?.combined ?? Number.POSITIVE_INFINITY) <= maxBudget);
        const fallback = cheapest(affordable);
        if (!fallback) {
          throw new Error(`code_provider_route_over_budget: ${chosen.pricing?.combined ?? 'prix inconnu'} $/Mtok > ${maxBudget}`);
        }
        return Object.freeze({
          providerId: fallback.id,
          modelId: fallback.modelId ?? null,
          capability: 'code.generate',
          locality: fallback.locality,
          pricing: fallback.pricing,
          mode: effectiveMode,
          reason: 'budget: repli sur le moins cher sous le plafond',
        });
      }
      return Object.freeze({
        providerId: chosen.id,
        modelId: chosen.modelId ?? null,
        capability: 'code.generate',
        locality: chosen.locality,
        pricing: chosen.pricing,
        mode: effectiveMode,
        reason: `mode ${effectiveMode}`,
      });
    },
  });
}
