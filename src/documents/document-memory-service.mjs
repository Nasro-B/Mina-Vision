function blockIdToIndex(blockId) {
  const match = /^b(\d+)$/u.exec(String(blockId));
  if (!match) throw new Error(`document_memory_block_id_invalid:${blockId}`);
  return Number(match[1]);
}

function parseBaseDate(value) {
  if (typeof value !== 'string' || value.length < 1) return null;
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (dateOnly) {
    const [, year, month, day] = dateOnly;
    const timestamp = Date.UTC(Number(year), Number(month) - 1, Number(day));
    return Number.isFinite(timestamp) ? timestamp : null;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function retentionExpiryMs(record) {
  const match = /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)D)?$/u.exec(String(record?.retention ?? ''));
  if (!match || (!match[1] && !match[2] && !match[3])) return null;
  const base = parseBaseDate(record.date ?? record.confirmedAt ?? record.proposedAt);
  if (base === null) return null;
  const expiry = new Date(base);
  expiry.setUTCFullYear(expiry.getUTCFullYear() + Number(match[1] ?? 0));
  expiry.setUTCMonth(expiry.getUTCMonth() + Number(match[2] ?? 0));
  expiry.setUTCDate(expiry.getUTCDate() + Number(match[3] ?? 0));
  const timestamp = expiry.getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function createDocumentMemoryService({ classifier, evidenceStore, ragRepository, sourceStore = null, clock } = {}) {
  if (!classifier?.getProposal) throw new TypeError('document_memory_service_classifier_required');
  if (!evidenceStore?.get || !evidenceStore?.markSelected) throw new TypeError('document_memory_service_evidence_store_required');
  if (!ragRepository?.indexChunk || !ragRepository?.countByDocument || !ragRepository?.deleteByDocument) {
    throw new TypeError('document_memory_service_rag_repository_required');
  }
  if (!clock || (typeof clock !== 'function' && typeof clock.now !== 'function')) {
    throw new TypeError('document_memory_service_clock_required');
  }
  const now = () => Number(typeof clock === 'function' ? clock() : clock.now());

  async function forgetDocument(input) {
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
  }

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

    forgetDocument,

    async purgeExpiredDocuments({ now: nowOverride = now(), deleteSource = true } = {}) {
      if (typeof classifier.listConfirmed !== 'function' || typeof classifier.deleteProposal !== 'function') {
        throw new TypeError('document_memory_classifier_purge_required');
      }
      if (typeof evidenceStore.delete !== 'function') throw new TypeError('document_memory_evidence_delete_required');
      const current = Number(nowOverride);
      if (!Number.isFinite(current)) throw new TypeError('document_memory_purge_now_invalid');
      const confirmed = await classifier.listConfirmed();
      const summary = {
        scanned: confirmed.length, purged: 0, kept: 0, failed: 0,
        chunksRemoved: 0, sourceFilesDeleted: 0, evidenceDeleted: 0, classificationsDeleted: 0,
      };
      for (const record of confirmed) {
        const expiry = retentionExpiryMs(record);
        if (expiry === null || expiry > current) {
          summary.kept += 1;
          continue;
        }
        try {
          // eslint-disable-next-line no-await-in-loop
          const forgotten = await forgetDocument({ documentId: record.documentId, deleteSource });
          summary.chunksRemoved += forgotten.chunksRemoved;
          if (forgotten.sourceFileDeleted) summary.sourceFilesDeleted += 1;
          // eslint-disable-next-line no-await-in-loop
          if (await evidenceStore.delete(record.documentId)) summary.evidenceDeleted += 1;
          // eslint-disable-next-line no-await-in-loop
          if (await classifier.deleteProposal(record.id)) summary.classificationsDeleted += 1;
          summary.purged += 1;
        } catch {
          summary.failed += 1;
        }
      }
      return Object.freeze(summary);
    },
  });
}
