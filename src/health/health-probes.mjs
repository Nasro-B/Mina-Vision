export function validateProbe(probe) {
  if (!probe || typeof probe.id !== 'string' || probe.id.length === 0) {
    throw new TypeError('health_probe_id_required');
  }
  if (typeof probe.resourceId !== 'string' || probe.resourceId.length === 0) {
    throw new TypeError('health_probe_resource_id_required');
  }
  if (typeof probe.read !== 'function') {
    throw new TypeError('health_probe_read_required');
  }
}

export function validateProbes(probes) {
  if (!Array.isArray(probes)) throw new TypeError('health_probes_array_required');
  const ids = new Set();
  for (const probe of probes) {
    validateProbe(probe);
    if (ids.has(probe.id)) throw new Error(`health_probe_id_duplicate:${probe.id}`);
    ids.add(probe.id);
  }
  return probes;
}
