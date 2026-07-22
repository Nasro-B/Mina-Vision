const LOCALITIES = new Set(['local', 'cloud']);
const NETWORKS = new Set(['none', 'loopback', 'lan', 'internet']);

function healthOf(provider) {
  try {
    const health = provider.health();
    if (!health || typeof health.then === 'function') throw new Error('provider_health_must_be_sync');
    return Object.freeze({ available: health.available === true, ...(health.reason ? { reason: String(health.reason) } : {}) });
  } catch (error) {
    return Object.freeze({ available: false, reason: String(error.message || error) });
  }
}

export function createProviderRegistry() {
  const providers = new Map();

  function register(provider) {
    if (!provider?.id || !LOCALITIES.has(provider.locality) || !NETWORKS.has(provider.network)
      || !Array.isArray(provider.capabilities) || provider.capabilities.length === 0
      || typeof provider.health !== 'function' || typeof provider.invoke !== 'function') {
      throw new TypeError('provider_definition_invalid');
    }
    if (providers.has(provider.id)) throw new Error(`provider_duplicate:${provider.id}`);
    const stored = Object.freeze({
      ...provider,
      capabilities: Object.freeze([...new Set(provider.capabilities)]),
    });
    providers.set(provider.id, stored);
    return metadata(stored);
  }

  function metadata(provider) {
    return Object.freeze({
      id: provider.id,
      locality: provider.locality,
      network: provider.network,
      capabilities: provider.capabilities,
      health: healthOf(provider),
      ...(provider.modelId ? { modelId: provider.modelId } : {}),
    });
  }

  function list() {
    return Object.freeze([...providers.values()].map(metadata));
  }

  function health(providerId) {
    const provider = providers.get(providerId);
    if (!provider) throw new Error(`provider_unknown:${providerId}`);
    return healthOf(provider);
  }

  async function invoke(route, input) {
    const provider = providers.get(route?.providerId);
    if (!provider) throw new Error(`provider_unknown:${route?.providerId}`);
    if (!provider.capabilities.includes(route.capability)) {
      throw new Error(`provider_capability_missing:${provider.id}:${route.capability}`);
    }
    if (!healthOf(provider).available) throw new Error(`provider_unavailable:${provider.id}`);
    const result = await provider.invoke(input, route);
    if (!result || typeof result !== 'object') throw new Error(`provider_result_invalid:${provider.id}`);
    return Object.freeze({ ...result, providerId: provider.id, modelId: result.modelId ?? route.modelId ?? provider.modelId ?? null });
  }

  return Object.freeze({ register, list, health, invoke });
}
