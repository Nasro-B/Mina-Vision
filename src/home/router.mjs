const ORDER = Object.freeze({ matter: 0, 'home-assistant': 1, 'google-home': 2, vendor: 3 });

export function createSmartHomeRouter({ connectors = [] } = {}) {
  const byId = new Map();
  connectors.forEach((connector) => {
    if (!connector?.id || typeof connector.health !== 'function' || typeof connector.supports !== 'function') {
      throw new TypeError('smart_home_connector_invalid');
    }
    if (byId.has(connector.id)) throw new Error('smart_home_connector_duplicate');
    byId.set(connector.id, connector);
  });

  function resolve({ device, action, offline = false } = {}) {
    const bindings = [...(device?.bindings ?? [])].sort((a, b) => (ORDER[a.connectorId] ?? 10) - (ORDER[b.connectorId] ?? 10));
    for (const binding of bindings) {
      const connector = byId.get(binding.connectorId);
      if (!connector || (offline && connector.network === 'internet')) continue;
      if (!connector.health()?.available || !binding.capabilities?.includes(action) || !connector.supports(binding, action)) continue;
      return Object.freeze({ status: 'resolved', connector, binding: Object.freeze(structuredClone(binding)) });
    }
    return Object.freeze({ status: 'unavailable' });
  }
  return Object.freeze({ resolve });
}
