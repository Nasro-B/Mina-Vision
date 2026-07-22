export function createCapabilityRouter({ providerRegistry, modePolicy } = {}) {
  if (!providerRegistry?.list || !modePolicy?.filter) throw new TypeError('capability_router_dependencies_required');
  return Object.freeze({
    resolve({ capability, mode = 'auto', offline = false, preferredProvider } = {}) {
      if (!capability) throw new TypeError('routing_capability_required');
      const candidates = providerRegistry.list()
        .filter((provider) => provider.health.available)
        .filter((provider) => provider.capabilities.includes(capability));
      const allowed = [...modePolicy.filter(candidates, { mode, offline })];
      if (preferredProvider) {
        const preferredIndex = allowed.findIndex(({ id }) => id === preferredProvider);
        if (preferredIndex > 0) allowed.unshift(...allowed.splice(preferredIndex, 1));
      }
      return Object.freeze(allowed.map((provider) => Object.freeze({
        providerId: provider.id,
        capability,
        locality: provider.locality,
        network: provider.network,
        ...(provider.modelId ? { modelId: provider.modelId } : {}),
      })));
    },
  });
}
