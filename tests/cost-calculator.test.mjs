import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { createCostCalculator } from '../src/usage/cost-calculator.mjs';
import { createPricingRegistry } from '../src/usage/pricing-registry.mjs';

const catalogUrl = new URL('../config/pricing-catalog.json', import.meta.url);

async function calculator() {
  const catalog = JSON.parse(await readFile(catalogUrl, 'utf8'));
  return createCostCalculator({ pricingRegistry: createPricingRegistry({ rows: catalog.rows }) });
}

function attempt(overrides = {}) {
  return {
    providerId: 'gemini', modelId: 'gemini-3.5-flash', locality: 'cloud',
    endedAt: '2026-07-15T07:00:00.000Z',
    units: {
      inputTokens: 1_000_000, cachedInputTokens: 500_000, outputTokens: 100_000,
      reasoningTokens: null, inputImages: null, inputAudioSeconds: null,
      outputAudioSeconds: null, localComputeMs: null,
    },
    ...overrides,
  };
}

describe('cost calculator', () => {
  it('calculates Gemini estimates in integer micro-USD without double billing cached tokens', async () => {
    expect((await calculator()).calculate(attempt())).toEqual(expect.objectContaining({
      costMicros: 1_725_000,
      currency: 'USD',
      costKind: 'catalog_estimate',
      pricingRevision: 'google-2026-07-09',
    }));
  });

  it('calculates DeepSeek V4 Flash cached and uncached input reproducibly', async () => {
    const result = (await calculator()).calculate(attempt({
      providerId: 'deepseek', modelId: 'deepseek-v4-flash',
      units: { ...attempt().units, inputTokens: 1_000_000, cachedInputTokens: 250_000, outputTokens: 500_000 },
    }));
    expect(result).toMatchObject({ costMicros: 245_700, costKind: 'catalog_estimate', pricingRevision: 'deepseek-v4-2026-07-15' });
  });

  it('prefers provider-reported cost and returns unknown for absent pricing or incomplete billable units', async () => {
    const value = await calculator();
    expect(value.calculate(attempt({ providerReportedCostMicros: 1234 })))
      .toMatchObject({ costMicros: 1234, costKind: 'provider_reported' });
    expect(value.calculate(attempt({ providerId: 'openrouter', modelId: 'dynamic/model' })))
      .toMatchObject({ costMicros: null, costKind: 'unknown' });
    expect(value.calculate(attempt({ units: { ...attempt().units, outputTokens: null } })))
      .toMatchObject({ costMicros: null, costKind: 'unknown' });
  });

  it('reports zero provider cost for local compute while preserving compute/energy separation', async () => {
    const result = (await calculator()).calculate(attempt({
      providerId: 'local-stt', modelId: 'whisper-local', locality: 'local',
      units: { ...attempt().units, inputTokens: null, cachedInputTokens: null, outputTokens: null, localComputeMs: 1_250 },
    }));
    expect(result).toEqual(expect.objectContaining({
      costMicros: 0,
      providerCostMicros: 0,
      costKind: 'provider_reported',
      localComputeMs: 1_250,
      energyCostMicros: null,
    }));
  });
});
