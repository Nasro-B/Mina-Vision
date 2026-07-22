export function createDomainRegistry({ domains = [] } = {}) {
  const byId = new Map();
  for (const domainDefinition of domains) {
    if (!domainDefinition?.id || typeof domainDefinition.start !== 'function') {
      throw new TypeError('domain_registry_definition_invalid');
    }
    if (byId.has(domainDefinition.id)) throw new Error('domain_registry_duplicate');
    byId.set(domainDefinition.id, domainDefinition);
  }

  const started = [];
  let status = 'idle';

  function get(id) {
    return started.find((entry) => entry.id === id)?.instance ?? null;
  }

  function isDegraded(id) {
    return Boolean(started.find((entry) => entry.id === id)?.degraded);
  }

  async function stopAll() {
    if (status === 'idle') return undefined;
    status = 'stopping';
    for (const entry of [...started].reverse()) {
      if (!entry.instance) continue;
      try {
        await byId.get(entry.id)?.stop?.(entry.instance);
      } catch {
        // Best-effort: one domain failing to stop cleanly must not block the others.
      }
    }
    started.length = 0;
    status = 'idle';
    return undefined;
  }

  async function startAll(context = {}) {
    if (status !== 'idle') throw new Error('domain_registry_already_started');
    status = 'starting';
    for (const domainDefinition of domains) {
      try {
        const instance = await domainDefinition.start({ ...context, get, isDegraded });
        started.push({ id: domainDefinition.id, instance, optional: Boolean(domainDefinition.optional) });
      } catch (error) {
        if (domainDefinition.optional) {
          started.push({ id: domainDefinition.id, instance: null, optional: true, degraded: true, error: error.message });
          continue;
        }
        await stopAll();
        status = 'idle';
        throw new Error(`domain_registry_start_failed:${domainDefinition.id}:${error.message}`);
      }
    }
    status = 'ready';
    return undefined;
  }

  return Object.freeze({ startAll, stopAll, get, isDegraded, status: () => status });
}
