export function createEmergencyMode({ corpus, networkPolicy, domainRegistry, deviceGuard, clock } = {}) {
  if (!corpus?.verify) throw new TypeError('emergency_mode_corpus_required');
  if (!networkPolicy?.disableAll || !networkPolicy?.restore) throw new TypeError('emergency_mode_network_policy_required');
  if (!domainRegistry?.disableExternal || !domainRegistry?.restore) throw new TypeError('emergency_mode_domain_registry_required');
  if (!deviceGuard?.disableCameraAndMic || !deviceGuard?.restore) throw new TypeError('emergency_mode_device_guard_required');
  if (!clock || (typeof clock !== 'function' && typeof clock.now !== 'function')) {
    throw new TypeError('emergency_mode_clock_required');
  }
  const now = () => Number(typeof clock === 'function' ? clock() : clock.now());

  let active = null;

  return Object.freeze({
    async activate(path) {
      const bundle = await corpus.verify(path);

      await networkPolicy.disableAll();
      await domainRegistry.disableExternal();
      await deviceGuard.disableCameraAndMic();

      active = Object.freeze({
        bundleId: bundle.bundleId,
        manifest: bundle.manifest,
        items: bundle.items,
        activatedAt: new Date(now()).toISOString(),
      });
      return Object.freeze({ active: true, bundleId: active.bundleId, itemCount: active.manifest.length });
    },

    async deactivate() {
      if (!active) return Object.freeze({ active: false });
      await networkPolicy.restore();
      await domainRegistry.restore();
      await deviceGuard.restore();
      active = null;
      return Object.freeze({ active: false });
    },

    async search(query) {
      if (!active) throw new Error('emergency_mode_not_active');
      const needle = String(query ?? '').toLocaleLowerCase('fr-FR');
      const results = active.manifest
        .filter((entry) => JSON.stringify(active.items[entry.itemId] ?? '').toLocaleLowerCase('fr-FR').includes(needle))
        .map((entry) => Object.freeze({ itemId: entry.itemId, classification: entry.classification, payload: active.items[entry.itemId], observedAt: entry.observedAt }));
      return Object.freeze({
        query, results: Object.freeze(results),
        observedAt: results[0]?.observedAt ?? active.activatedAt,
      });
    },

    status() {
      return Object.freeze({ active: Boolean(active), bundleId: active?.bundleId ?? null });
    },
  });
}
