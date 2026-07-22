const PRICE_KEYS = new Set([
  'inputTokensPerMillion',
  'cachedInputTokensPerMillion',
  'outputTokensPerMillion',
  'inputImage',
  'inputAudioSecond',
  'outputAudioSecond',
]);
const DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/u;

function freezeRow(row) {
  const effective = Date.parse(row?.effectiveFrom);
  const retrieved = Date.parse(row?.retrievedAt);
  let url;
  try { url = new URL(row?.sourceUrl); } catch { throw new TypeError('pricing_row_invalid'); }
  if (!row?.revision || !row?.providerId || !row?.modelId || !/^[A-Z]{3}$/u.test(row.currency ?? '')
    || url.protocol !== 'https:' || !Number.isFinite(effective) || !Number.isFinite(retrieved)
    || !row.unitPrices || Object.keys(row.unitPrices).length === 0
    || Object.entries(row.unitPrices).some(([key, value]) => !PRICE_KEYS.has(key) || !DECIMAL.test(String(value)))) {
    throw new TypeError('pricing_row_invalid');
  }
  return Object.freeze({
    revision: String(row.revision),
    providerId: String(row.providerId),
    modelId: String(row.modelId),
    sourceUrl: url.toString(),
    retrievedAt: new Date(retrieved).toISOString(),
    effectiveFrom: new Date(effective).toISOString(),
    currency: row.currency,
    unitPrices: Object.freeze(Object.fromEntries(Object.entries(row.unitPrices).map(([key, value]) => [key, String(value)]))),
  });
}

export function createPricingRegistry({ rows = [] } = {}) {
  const catalog = Object.freeze(rows.map(freezeRow).sort((left, right) => (
    left.providerId.localeCompare(right.providerId)
    || left.modelId.localeCompare(right.modelId)
    || Date.parse(left.effectiveFrom) - Date.parse(right.effectiveFrom)
  )));

  function history({ providerId, modelId } = {}) {
    return Object.freeze(catalog.filter((row) => row.providerId === providerId && row.modelId === modelId));
  }

  function resolve({ providerId, modelId, at, currency = 'USD' } = {}) {
    const instant = Date.parse(at);
    if (!Number.isFinite(instant)) throw new TypeError('pricing_date_invalid');
    return history({ providerId, modelId })
      .filter((row) => row.currency === currency && Date.parse(row.effectiveFrom) <= instant)
      .at(-1) ?? null;
  }

  return Object.freeze({ resolve, history, list: () => catalog });
}
