export function createEmergencyController({ corpus, mode } = {}) {
  if (!corpus?.build || !corpus?.verify) throw new TypeError('emergency_controller_corpus_required');
  if (!mode?.activate || !mode?.deactivate || !mode?.search || !mode?.status) throw new TypeError('emergency_controller_mode_required');

  return Object.freeze({
    buildCorpus: (selection) => corpus.build(selection),
    verifyCorpus: (path) => corpus.verify(path),
    activate: (path) => mode.activate(path),
    deactivate: () => mode.deactivate(),
    search: (query) => mode.search(query),

    async status() {
      const state = mode.status();
      return Object.freeze({ ...state, network: state.active ? 'disabled' : 'enabled' });
    },
  });
}
