export function createPersonalDataHub({ adapters } = {}) {
  if (!Array.isArray(adapters)) throw new TypeError('personal_data_hub_adapters_required');
  const byId = new Map();
  for (const adapter of adapters) {
    if (byId.has(adapter.id)) throw new Error(`personal_data_hub_adapter_id_duplicate:${adapter.id}`);
    byId.set(adapter.id, adapter);
  }

  return Object.freeze({
    adapter(id) {
      const found = byId.get(id);
      if (!found) throw new Error('adapter_not_found');
      return found;
    },
    health: () => Promise.all(adapters.map((adapter) => adapter.health())),
  });
}
