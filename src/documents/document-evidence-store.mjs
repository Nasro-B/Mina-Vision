export function createDocumentEvidenceStore({ repository, clock } = {}) {
  if (!repository?.put || !repository?.get) throw new TypeError('document_evidence_store_repository_required');
  if (!clock || (typeof clock !== 'function' && typeof clock.now !== 'function')) {
    throw new TypeError('document_evidence_store_clock_required');
  }
  const now = () => Number(typeof clock === 'function' ? clock() : clock.now());

  async function readState(documentId) {
    return (await repository.get(documentId)) ?? { observation: null, selectedBlockIndexes: [] };
  }

  async function get(documentId) {
    const state = await readState(documentId);
    return state.observation ?? null;
  }

  return Object.freeze({
    async store(observation) {
      const state = await readState(observation.documentId);
      await repository.put(observation.documentId, { ...state, observation, storedAt: now() });
      return observation;
    },

    get,

    async getBlock(documentId, blockIndex) {
      const observation = await get(documentId);
      return observation?.blocks?.[blockIndex] ?? null;
    },

    async markSelected(documentId, blockIndexes) {
      const state = await readState(documentId);
      if (!state.observation) throw new Error('document_not_parsed');
      const selectedBlockIndexes = [...new Set([...state.selectedBlockIndexes, ...blockIndexes])];
      await repository.put(documentId, { ...state, selectedBlockIndexes });
      return Object.freeze([...selectedBlockIndexes]);
    },

    async isSelected(documentId, blockIndex) {
      const state = await readState(documentId);
      return state.selectedBlockIndexes.includes(blockIndex);
    },

    async listSelected(documentId) {
      const state = await readState(documentId);
      return Object.freeze([...state.selectedBlockIndexes]);
    },
  });
}
