export function createConnectorRegistry({ clock } = {}) {
  if (!clock || (typeof clock !== 'function' && typeof clock.now !== 'function')) {
    throw new TypeError('connector_registry_clock_required');
  }
  const now = () => Number(typeof clock === 'function' ? clock() : clock.now());
  const connectors = new Map();

  function requireConnector(connectorId) {
    const entry = connectors.get(connectorId);
    if (!entry) throw new Error('connector_not_registered');
    return entry;
  }

  return Object.freeze({
    register({ connectorId, manifest, runtime }) {
      if (typeof connectorId !== 'string' || connectorId.length === 0) throw new TypeError('connector_id_required');
      if (!runtime?.health || !runtime?.simulate || !runtime?.invoke || !runtime?.verify) {
        throw new TypeError('connector_runtime_invalid');
      }
      const entry = Object.freeze({ connectorId, manifest, runtime, registeredAt: new Date(now()).toISOString() });
      connectors.set(connectorId, entry);
      return entry;
    },

    async health(connectorId) {
      return requireConnector(connectorId).runtime.health();
    },

    async simulate({ connectorId, capability, input, signal }) {
      return requireConnector(connectorId).runtime.simulate({ capability, input, signal });
    },

    async invoke({ connectorId, capability, input, signal }) {
      return requireConnector(connectorId).runtime.invoke({ capability, input, signal });
    },

    async verify({ connectorId, capability, output }) {
      return requireConnector(connectorId).runtime.verify({ capability, output });
    },

    async list() {
      return Object.freeze([...connectors.values()]);
    },
  });
}
