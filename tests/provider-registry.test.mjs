import { describe, expect, it, vi } from 'vitest';
import { createProviderRegistry } from '../src/providers/provider-registry.mjs';

const provider = (overrides = {}) => ({
  id: 'local-text', locality: 'local', network: 'none', capabilities: ['text.generate'],
  health: () => ({ available: true }), invoke: vi.fn(async (input) => ({ output: input })), ...overrides,
});

describe('provider registry', () => {
  it('rejects duplicate IDs and exposes frozen metadata without invoke functions', () => {
    const registry = createProviderRegistry();
    registry.register(provider());
    expect(() => registry.register(provider())).toThrow('provider_duplicate:local-text');
    expect(registry.list()).toEqual([expect.objectContaining({ id: 'local-text', locality: 'local' })]);
    expect(registry.list()[0].invoke).toBeUndefined();
    expect(Object.isFrozen(registry.list())).toBe(true);
  });

  it('refuses unavailable or incapable providers and returns the provider actually used', async () => {
    const invoke = vi.fn(async () => ({ output: 'ok' }));
    const registry = createProviderRegistry();
    registry.register(provider({ invoke }));
    registry.register(provider({ id: 'down', health: () => ({ available: false, reason: 'closed_port' }) }));

    await expect(registry.invoke({ providerId: 'down', capability: 'text.generate' }, {})).rejects.toThrow('provider_unavailable:down');
    await expect(registry.invoke({ providerId: 'local-text', capability: 'vision.analyze' }, {})).rejects.toThrow('provider_capability_missing');
    await expect(registry.invoke({ providerId: 'local-text', capability: 'text.generate' }, { prompt: 'x' }))
      .resolves.toMatchObject({ providerId: 'local-text', output: 'ok' });
  });
});
