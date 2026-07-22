function decimalMicros(value) {
  const [whole, fraction = ''] = String(value).split('.');
  return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0'));
}

function roundedDivide(numerator, denominator) {
  return (numerator + denominator / 2n) / denominator;
}

function integerMicros(value) {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('cost_overflow');
  return Number(value);
}

export function createCostCalculator({ pricingRegistry } = {}) {
  if (!pricingRegistry?.resolve) throw new TypeError('pricing_registry_required');

  function unknown(currency = null) {
    return Object.freeze({ costMicros: null, providerCostMicros: null, currency, costKind: 'unknown', pricingRevision: null });
  }

  function calculate(attempt = {}) {
    if (attempt.locality === 'local') {
      return Object.freeze({
        costMicros: 0,
        providerCostMicros: 0,
        currency: 'USD',
        costKind: 'provider_reported',
        pricingRevision: null,
        localComputeMs: attempt.units?.localComputeMs ?? null,
        energyCostMicros: null,
      });
    }
    if (attempt.providerReportedCostMicros !== undefined && attempt.providerReportedCostMicros !== null) {
      if (!Number.isSafeInteger(attempt.providerReportedCostMicros) || attempt.providerReportedCostMicros < 0) {
        throw new TypeError('provider_cost_invalid');
      }
      return Object.freeze({
        costMicros: attempt.providerReportedCostMicros,
        providerCostMicros: attempt.providerReportedCostMicros,
        currency: attempt.providerReportedCurrency ?? 'USD',
        costKind: 'provider_reported',
        pricingRevision: null,
      });
    }
    const price = pricingRegistry.resolve({
      providerId: attempt.providerId,
      modelId: attempt.modelId,
      at: attempt.endedAt,
      currency: attempt.currency ?? 'USD',
    });
    if (!price) return unknown(attempt.currency ?? 'USD');
    const units = attempt.units ?? {};
    const input = units.inputTokens;
    const cached = units.cachedInputTokens;
    const output = units.outputTokens;
    if (input === null || input === undefined || output === null || output === undefined
      || (price.unitPrices.cachedInputTokensPerMillion !== undefined && (cached === null || cached === undefined))
      || !Number.isSafeInteger(input) || !Number.isSafeInteger(output) || input < 0 || output < 0
      || (cached !== null && cached !== undefined && (!Number.isSafeInteger(cached) || cached < 0 || cached > input))) {
      return unknown(price.currency);
    }
    const cachedTokens = BigInt(cached ?? 0);
    const inputTokens = BigInt(input) - cachedTokens;
    const outputTokens = BigInt(output);
    const inputPrice = decimalMicros(price.unitPrices.inputTokensPerMillion);
    const cachedPrice = decimalMicros(price.unitPrices.cachedInputTokensPerMillion ?? price.unitPrices.inputTokensPerMillion);
    const outputPrice = decimalMicros(price.unitPrices.outputTokensPerMillion);
    const numerator = inputTokens * inputPrice + cachedTokens * cachedPrice + outputTokens * outputPrice;
    const costMicros = integerMicros(roundedDivide(numerator, 1_000_000n));
    return Object.freeze({
      costMicros,
      providerCostMicros: null,
      currency: price.currency,
      costKind: 'catalog_estimate',
      pricingRevision: price.revision,
      sourceUrl: price.sourceUrl,
    });
  }

  return Object.freeze({ calculate });
}
