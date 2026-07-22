const ORDER = Object.freeze({
  auto: Object.freeze(['cloud', 'local']),
  'local-first': Object.freeze(['local', 'cloud']),
  'local-only': Object.freeze(['local']),
});

export function createInferenceModePolicy() {
  return Object.freeze({
    filter(candidates, { mode = 'auto', offline = false } = {}) {
      const localityOrder = ORDER[mode];
      if (!localityOrder) throw new Error(`inference_mode_invalid:${mode}`);
      return Object.freeze(candidates
        .map((candidate, index) => ({ candidate, index }))
        .filter(({ candidate }) => localityOrder.includes(candidate.locality))
        .filter(({ candidate }) => !offline || ['none', 'loopback'].includes(candidate.network))
        .sort((left, right) => (
          localityOrder.indexOf(left.candidate.locality) - localityOrder.indexOf(right.candidate.locality)
          || left.index - right.index
        ))
        .map(({ candidate }) => candidate));
    },
  });
}
