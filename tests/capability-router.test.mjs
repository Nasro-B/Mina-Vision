import { describe, expect, it } from 'vitest';
import { createCapabilityRouter } from '../src/routing/capability-router.mjs';
import { createInferenceModePolicy } from '../src/routing/inference-mode-policy.mjs';
import { createProviderRegistry } from '../src/providers/provider-registry.mjs';

function registry() {
  const value = createProviderRegistry();
  const add = (id, locality, network, capabilities, available = true) => value.register({
    id, locality, network, capabilities, health: () => ({ available }), invoke: async () => ({}),
  });
  add('cloud-a', 'cloud', 'internet', ['text.generate']);
  add('local-a', 'local', 'loopback', ['text.generate']);
  add('local-b', 'local', 'none', ['text.generate']);
  add('down', 'local', 'none', ['text.generate'], false);
  return value;
}

describe('capability router', () => {
  it('returns stable frozen routes and treats preferredProvider only as a preference', () => {
    const router = createCapabilityRouter({ providerRegistry: registry(), modePolicy: createInferenceModePolicy() });
    const routes = router.resolve({ capability: 'text.generate', mode: 'local-first', offline: false, preferredProvider: 'local-b' });
    expect(routes.map(({ providerId }) => providerId)).toEqual(['local-b', 'local-a', 'cloud-a']);
    expect(Object.isFrozen(routes)).toBe(true);

    expect(router.resolve({ capability: 'text.generate', mode: 'local-only', preferredProvider: 'cloud-a' })
      .map(({ providerId }) => providerId)).toEqual(['local-a', 'local-b']);
  });

  it('removes unhealthy, incapable and external-network routes under the relevant policies', () => {
    const router = createCapabilityRouter({ providerRegistry: registry(), modePolicy: createInferenceModePolicy() });
    expect(router.resolve({ capability: 'text.generate', mode: 'auto', offline: true }).map(({ providerId }) => providerId))
      .toEqual(['local-a', 'local-b']);
    expect(router.resolve({ capability: 'vision.analyze', mode: 'auto' })).toEqual([]);
  });
});
