const SAFE_REASON = /^[a-z][a-z0-9_:-]{0,199}$/u;

function reasonFromProbe(probe) {
  return typeof probe?.reason === 'string' && SAFE_REASON.test(probe.reason)
    ? probe.reason
    : 'runtime_probe_not_ready';
}

export function capabilityFromReadiness({ id, implemented, probe } = {}) {
  if (typeof id !== 'string' || id.length === 0) throw new TypeError('capability_readiness_id_required');
  if (typeof implemented !== 'boolean') throw new TypeError('capability_readiness_implemented_required');

  if (!implemented) {
    return Object.freeze({
      id,
      status: 'unavailable',
      reason: 'not_implemented',
      evidence: Object.freeze(['unit']),
    });
  }

  if (!probe || typeof probe !== 'object') {
    return Object.freeze({
      id,
      status: 'available',
      reason: null,
      evidence: Object.freeze(['unit']),
    });
  }

  if (probe.ready === true) {
    return Object.freeze({
      id,
      status: 'available',
      reason: null,
      evidence: Object.freeze(['unit', 'health']),
    });
  }

  return Object.freeze({
    id,
    status: 'degraded',
    reason: reasonFromProbe(probe),
    evidence: Object.freeze(['unit', 'health']),
  });
}
