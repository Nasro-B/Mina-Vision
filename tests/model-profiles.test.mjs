import { describe, expect, it } from 'vitest';
import { createModelProfiles } from '../src/models/model-profiles.mjs';

const profiles = Object.freeze([
  {
    id: 'deepseek-fast', providerId: 'deepseek', modelId: 'deepseek-v4-flash',
    capabilities: ['text.generate', 'code.generate'],
    price: { currency: 'USD', inputMicrosPerMillion: 140_000, outputMicrosPerMillion: 280_000, validFrom: '2026-07-01T00:00:00.000Z', validUntil: '2026-08-01T00:00:00.000Z' },
    limits: { maxTokens: 2_000_000, maxCostMicros: 500_000, maxDurationMs: 60_000 },
  },
  {
    id: 'local-code', providerId: 'lm-studio', modelId: 'qwen-code-7b',
    capabilities: ['code.generate'], price: null,
    limits: { maxTokens: 8_192, maxCostMicros: 0, maxDurationMs: 120_000 },
  },
]);

describe('declarative model profiles', () => {
  it('resolves a capability and estimates integer micro-USD under the profile limits', () => {
    const registry = createModelProfiles({ profiles, clock: () => Date.parse('2026-07-15T00:00:00.000Z') });
    expect(registry.resolve({ providerId: 'deepseek', modelId: 'deepseek-v4-flash', capability: 'code.generate' }))
      .toMatchObject({ id: 'deepseek-fast' });
    expect(registry.estimate({ profileId: 'deepseek-fast', inputTokens: 1_000_000, outputTokens: 500_000, requestedDurationMs: 30_000 }))
      .toEqual({ costMicros: 280_000, currency: 'USD', costKind: 'profile_estimate', blocked: false });
  });

  it('marks absent or expired prices unknown and blocks automatic cloud calculation', () => {
    const expired = createModelProfiles({ profiles, clock: () => Date.parse('2026-09-01T00:00:00.000Z') });
    expect(expired.estimate({ profileId: 'deepseek-fast', inputTokens: 10, outputTokens: 10, requestedDurationMs: 1 }))
      .toEqual({ costMicros: null, currency: 'USD', costKind: 'unknown', blocked: true, reason: 'profile_price_expired' });
    const local = createModelProfiles({ profiles, clock: () => Date.parse('2026-07-15T00:00:00.000Z') });
    expect(local.estimate({ profileId: 'local-code', inputTokens: 10, outputTokens: 10, requestedDurationMs: 1 }))
      .toEqual({ costMicros: 0, currency: null, costKind: 'local_compute', blocked: false });
  });

  it('denies token, cost and duration excess before invocation', () => {
    const registry = createModelProfiles({ profiles, clock: () => Date.parse('2026-07-15T00:00:00.000Z') });
    expect(() => registry.estimate({ profileId: 'deepseek-fast', inputTokens: 2_000_001, outputTokens: 0, requestedDurationMs: 1 }))
      .toThrow('model_profile_limit_exceeded:tokens');
    expect(() => registry.estimate({ profileId: 'deepseek-fast', inputTokens: 1, outputTokens: 1, requestedDurationMs: 60_001 }))
      .toThrow('model_profile_limit_exceeded:duration');
    const costly = [{ ...profiles[0], price: { ...profiles[0].price, inputMicrosPerMillion: 20_000_000_000 } }];
    expect(() => createModelProfiles({ profiles: costly, clock: () => Date.parse('2026-07-15T00:00:00.000Z') })
      .estimate({ profileId: 'deepseek-fast', inputTokens: 1_000_000, outputTokens: 0, requestedDurationMs: 1 }))
      .toThrow('model_profile_limit_exceeded:cost');
  });

  it('rejects duplicate or malformed declarative profiles', () => {
    expect(() => createModelProfiles({ profiles: [profiles[0], profiles[0]] })).toThrow('model_profile_duplicate:deepseek-fast');
    expect(() => createModelProfiles({ profiles: [{ ...profiles[0], capabilities: ['host.shell'] }] }))
      .toThrow('model_profile_capability_invalid:host.shell');
  });
});
