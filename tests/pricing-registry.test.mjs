import { describe, expect, it } from 'vitest';
import { createPricingRegistry } from '../src/usage/pricing-registry.mjs';

const rows = [
  {
    revision: 'old', providerId: 'fixture', modelId: 'model', currency: 'USD',
    sourceUrl: 'https://example.test/pricing', retrievedAt: '2026-01-01T00:00:00.000Z',
    effectiveFrom: '2026-01-01T00:00:00.000Z', unitPrices: { inputTokensPerMillion: '1.00', outputTokensPerMillion: '2.00' },
  },
  {
    revision: 'new', providerId: 'fixture', modelId: 'model', currency: 'USD',
    sourceUrl: 'https://example.test/pricing', retrievedAt: '2026-07-01T00:00:00.000Z',
    effectiveFrom: '2026-07-01T00:00:00.000Z', unitPrices: { inputTokensPerMillion: '1.50', outputTokensPerMillion: '3.00' },
  },
];

describe('pricing registry', () => {
  it('resolves the latest effective revision while retaining history', () => {
    const registry = createPricingRegistry({ rows });

    expect(registry.resolve({ providerId: 'fixture', modelId: 'model', at: '2026-06-30T23:59:59.000Z', currency: 'USD' }))
      .toMatchObject({ revision: 'old' });
    expect(registry.resolve({ providerId: 'fixture', modelId: 'model', at: '2026-07-15T00:00:00.000Z', currency: 'USD' }))
      .toMatchObject({ revision: 'new' });
    expect(registry.history({ providerId: 'fixture', modelId: 'model' }).map(({ revision }) => revision))
      .toEqual(['old', 'new']);
  });

  it('returns null for unknown model/currency/date and rejects unverifiable rows', () => {
    const registry = createPricingRegistry({ rows });
    expect(registry.resolve({ providerId: 'fixture', modelId: 'missing', at: '2026-07-15T00:00:00.000Z', currency: 'USD' })).toBeNull();
    expect(registry.resolve({ providerId: 'fixture', modelId: 'model', at: '2025-01-01T00:00:00.000Z', currency: 'USD' })).toBeNull();
    expect(registry.resolve({ providerId: 'fixture', modelId: 'model', at: '2026-07-15T00:00:00.000Z', currency: 'EUR' })).toBeNull();
    expect(() => createPricingRegistry({ rows: [{ ...rows[0], sourceUrl: '', unitPrices: { inputTokensPerMillion: -1 } }] }))
      .toThrow('pricing_row_invalid');
  });
});
