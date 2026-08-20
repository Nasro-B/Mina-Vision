const STORAGE_MODES = new Set(['metadata-only', 'full']);

function finiteConfidence(value) {
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
}

function metadataLocator(sourceOffset) {
  const source = sourceOffset && typeof sourceOffset === 'object' ? sourceOffset : {};
  const kind = source.kind === 'pdf_text' || source.kind === 'ocr' ? source.kind : 'unknown';
  const locator = { kind };
  if (Number.isInteger(source.page) && source.page > 0) locator.page = source.page;
  if (kind === 'pdf_text') {
    if (Number.isInteger(source.start) && source.start >= 0) locator.start = source.start;
    if (Number.isInteger(source.end) && source.end >= 0) locator.end = source.end;
  }
  if (kind === 'ocr' && Array.isArray(source.box) && source.box.length === 4 && source.box.every(Number.isFinite)) {
    locator.box = [...source.box];
  }
  return Object.freeze(locator);
}

function metadataObservation(observation) {
  const blocks = Array.isArray(observation?.blocks) ? observation.blocks : [];
  return Object.freeze({
    documentId: observation?.documentId,
    mediaType: typeof observation?.mediaType === 'string' ? observation.mediaType : 'unknown',
    pageCount: Number.isInteger(observation?.pageCount) && observation.pageCount > 0 ? observation.pageCount : null,
    parserId: typeof observation?.parserId === 'string' ? observation.parserId : 'unknown',
    parserVersion: typeof observation?.parserVersion === 'string' ? observation.parserVersion : 'unknown',
    observedAt: typeof observation?.observedAt === 'string' ? observation.observedAt : null,
    confidence: finiteConfidence(observation?.confidence),
    blocks: Object.freeze(blocks.map((block) => Object.freeze({
      sourceOffset: metadataLocator(block?.sourceOffset),
      confidence: finiteConfidence(block?.confidence),
    }))),
  });
}

export function createDocumentEvidenceStore({ repository, clock, storageMode = 'metadata-only' } = {}) {
  if (!repository?.put || !repository?.get) throw new TypeError('document_evidence_store_repository_required');
  if (!clock || (typeof clock !== 'function' && typeof clock.now !== 'function')) {
    throw new TypeError('document_evidence_store_clock_required');
  }
  if (!STORAGE_MODES.has(storageMode)) throw new TypeError('document_evidence_store_storage_mode_invalid');
  const now = () => Number(typeof clock === 'function' ? clock() : clock.now());

  async function readState(documentId) {
    return (await repository.get(documentId)) ?? { observation: null, selectedBlockIndexes: [] };
  }

  async function get(documentId) {
    const state = await readState(documentId);
    return state.observation ?? null;
  }

  return Object.freeze({
    storageMode,
    async store(observation) {
      const state = await readState(observation.documentId);
      const storedObservation = storageMode === 'metadata-only' ? metadataObservation(observation) : observation;
      await repository.put(observation.documentId, { ...state, observation: storedObservation, storedAt: now() });
      return storedObservation;
    },

    get,

    async delete(documentId) {
      if (typeof repository.delete !== 'function') throw new TypeError('document_evidence_store_delete_unsupported');
      return repository.delete(documentId);
    },

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
