function blockIdToIndex(blockId) {
  const match = /^b(\d+)$/u.exec(String(blockId));
  if (!match) throw new Error(`document_memory_block_id_invalid:${blockId}`);
  return Number(match[1]);
}

export function createDocumentMemoryService({ classifier, evidenceStore, ragRepository, sourceStore = null, clock } = {}) {
  if (!classifier?.getProposal) throw new TypeError('document_memory_service_classifier_required');
  if (!evidenceStore?.get || !evidenceStore?.markSelected) throw new TypeError('document_memory_service_evidence_store_required');
  if (!ragRepository?.indexChunk || !ragRepository?.countByDocument) throw new TypeError('document_memory_service_rag_repository_required');
  if (!clock || (typeof clock !== 'function' && typeof clock.now !== 'function')) {
    throw new TypeError('document_memory_service_clock_required');
  }
  const now = () => Number(typeof clock === 'function' ? clock() : clock.now());

  return Object.freeze({
    async indexSelection({ proposalId, blockIds }) {
      const proposal = await classifier.getProposal(proposalId);
      if (!proposal) throw new Error('classification_proposal_not_found');
      const observation = await evidenceStore.get(proposal.documentId);
      if (!observation) throw new Error('document_not_parsed');

      const indexes = blockIds.map(blockIdToIndex);
      const indexed = [];
      for (const index of indexes) {
        const block = observation.blocks[index];
        if (!block) throw new Error(`document_memory_block_not_found:b${index}`);
        indexed.push({
          documentId: proposal.documentId,
          digest: observation.digest ?? null,
          locator: block.sourceOffset,
          classification: proposal.classification,
          project: proposal.project,
          category: proposal.category,
          text: block.text,
          indexedAt: new Date(now()).toISOString(),
        });
      }
      for (const chunk of indexed) {
        // eslint-disable-next-line no-await-in-loop
        await ragRepository.indexChunk(chunk);
      }
      await evidenceStore.markSelected(proposal.documentId, indexes);
      return Object.freeze({ documentId: proposal.documentId, indexed: indexed.length });
    },

    async forgetDocument(input) {
      const request = typeof input === 'object' && input !== null ? input : { documentId: input };
      const { documentId } = request;
      const removed = await ragRepository.deleteByDocument(documentId);
      let sourceFileDeleted = false;
      if (request.deleteSource === true) {
        if (!sourceStore?.deleteBytes || !sourceStore?.deleteRecord) {
          throw new TypeError('document_memory_source_store_required');
        }
        await sourceStore.deleteBytes(documentId);
        await sourceStore.deleteRecord(documentId);
        sourceFileDeleted = true;
      }
      return Object.freeze({ documentId, chunksRemoved: removed ?? 0, sourceFileDeleted });
    },
  });
}
