import { describe, expect, it, vi } from 'vitest';
import { createDocumentClassifier } from '../src/documents/document-classifier.mjs';
import { createDocumentEvidenceStore } from '../src/documents/document-evidence-store.mjs';
import { createDocumentMemoryService } from '../src/documents/document-memory-service.mjs';

function fakeRepository() {
  const rows = new Map();
  return { async put(id, r) { rows.set(id, r); }, async get(id) { return rows.get(id) ?? null; } };
}

function fakeRag() {
  const chunks = [];
  return {
    chunks,
    indexChunk: vi.fn(async (chunk) => { chunks.push(chunk); }),
    countByDocument: vi.fn(async (documentId) => chunks.filter((c) => c.documentId === documentId).length),
    deleteByDocument: vi.fn(async (documentId) => {
      const before = chunks.length;
      const remaining = chunks.filter((c) => c.documentId !== documentId);
      chunks.length = 0;
      chunks.push(...remaining);
      return before - remaining.length;
    }),
  };
}

const observation = Object.freeze({
  documentId: 'd1', mediaType: 'application/pdf', digest: 'sha256:abc',
  blocks: [
    { text: 'bloc zéro', sourceOffset: { page: 1, start: 0, end: 5 }, confidence: 0.9 },
    { text: 'bloc un', sourceOffset: { page: 1, start: 6, end: 11 }, confidence: 0.9 },
  ],
});

async function buildWorld() {
  const classifier = createDocumentClassifier({ repository: fakeRepository(), clock: () => 0 });
  const evidenceStore = createDocumentEvidenceStore({ repository: fakeRepository(), clock: () => 0, storageMode: 'full' });
  await evidenceStore.store(observation);
  const rag = fakeRag();
  const memory = createDocumentMemoryService({ classifier, evidenceStore, ragRepository: rag, clock: () => 0 });
  return { classifier, evidenceStore, rag, memory };
}

describe('createDocumentMemoryService: constructor guards', () => {
  it('requires a classifier', async () => {
    const { evidenceStore, rag } = await buildWorld();
    expect(() => createDocumentMemoryService({ evidenceStore, ragRepository: rag, clock: () => 0 }))
      .toThrow('document_memory_service_classifier_required');
  });
});

describe('createDocumentMemoryService.indexSelection: nothing is indexed until explicitly selected', () => {
  it('proposeClassification alone never indexes anything; indexSelection indexes exactly the chosen blocks', async () => {
    const { classifier, rag, memory } = await buildWorld();
    const proposal = await classifier.proposeClassification(observation);
    expect(await rag.countByDocument(observation.documentId)).toBe(0);

    await memory.indexSelection({ proposalId: proposal.id, blockIds: ['b1'] });
    expect(await rag.countByDocument(observation.documentId)).toBe(1);
    expect(rag.chunks[0]).toMatchObject({ documentId: 'd1', digest: 'sha256:abc', text: 'bloc un', classification: proposal.classification });
  });

  it('works directly off a proposed (not yet confirmed) classification, matching the plan example', async () => {
    const { classifier, memory } = await buildWorld();
    const proposal = await classifier.proposeClassification(observation);
    expect(proposal.status).toBe('proposed');
    await expect(memory.indexSelection({ proposalId: proposal.id, blockIds: ['b0'] })).resolves.toMatchObject({ indexed: 1 });
  });

  it('marks the selected blocks in the evidence store', async () => {
    const { classifier, evidenceStore, memory } = await buildWorld();
    const proposal = await classifier.proposeClassification(observation);
    await memory.indexSelection({ proposalId: proposal.id, blockIds: ['b0', 'b1'] });
    expect(await evidenceStore.listSelected('d1')).toEqual([0, 1]);
  });

  it('indexes multiple selected blocks as separate chunks', async () => {
    const { classifier, rag, memory } = await buildWorld();
    const proposal = await classifier.proposeClassification(observation);
    await memory.indexSelection({ proposalId: proposal.id, blockIds: ['b0', 'b1'] });
    expect(await rag.countByDocument('d1')).toBe(2);
  });

  it('rejects an unknown proposalId', async () => {
    const { memory } = await buildWorld();
    await expect(memory.indexSelection({ proposalId: 'missing', blockIds: ['b0'] })).rejects.toThrow('classification_proposal_not_found');
  });

  it('rejects a blockId that does not exist on the observation', async () => {
    const { classifier, memory } = await buildWorld();
    const proposal = await classifier.proposeClassification(observation);
    await expect(memory.indexSelection({ proposalId: proposal.id, blockIds: ['b99'] })).rejects.toThrow('document_memory_block_not_found:b99');
  });
});

describe('createDocumentMemoryService.forgetDocument', () => {
  it('cascades chunk removal from RAG but never claims to delete the source file', async () => {
    const { classifier, memory, rag } = await buildWorld();
    const proposal = await classifier.proposeClassification(observation);
    await memory.indexSelection({ proposalId: proposal.id, blockIds: ['b0', 'b1'] });
    const result = await memory.forgetDocument('d1');
    expect(result).toMatchObject({ documentId: 'd1', chunksRemoved: 2, sourceFileDeleted: false });
    expect(await rag.countByDocument('d1')).toBe(0);
  });
});
