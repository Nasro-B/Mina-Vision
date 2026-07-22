const FUSION_WINDOW_MS = 750;

export function fuseObservation({ modalities } = {}) {
  const entries = Object.entries(modalities ?? {}).filter(([, value]) => value != null);
  if (entries.length < 1) throw new TypeError('observation_fusion_empty');

  const times = entries.map(([, value]) => value.observedAtMs);
  const minTime = Math.min(...times);
  const maxTime = Math.max(...times);
  const synchronization = (maxTime - minTime) <= FUSION_WINDOW_MS ? 'aligned' : 'unaligned';

  const modalitiesOut = {};
  for (const [key, value] of entries) {
    const { observedAtMs, ...provenance } = value;
    modalitiesOut[key] = Object.freeze(provenance);
  }

  return Object.freeze({
    observedAt: new Date(maxTime).toISOString(),
    modalities: Object.freeze(modalitiesOut),
    synchronization,
  });
}
