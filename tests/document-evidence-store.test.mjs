import { describe, expect, it } from 'vitest';
import { createDocumentEvidenceStore } from '../src/documents/document-evidence-store.mjs';

function fakeRepository() {
  const rows = new Map();
  return {
    async put(id, record) { rows.set(id, record); },
    async get(id) { return rows.get(id) ?? null; },
  };
}

function observation(overrides = {}) {
  return { documentId: 'd1', mediaType: 'application/pdf', blocks: [{ text: 'A' }, { text: 'B' }], ...overrides };
}

describe('createDocumentEvidenceStore: constructor guards', () => {
  it('requires a repository', () => {
    expect(() => createDocumentEvidenceStore({ clock: () => 0 })).toThrow('document_evidence_store_repository_required');
  });
});

describe('createDocumentEvidenceStore: store / get', () => {
  it('stores and retrieves an observation', async () => {
    const store = createDocumentEvidenceStore({ repository: fakeRepository(), clock: () => 0 });
    await store.store(observation());
    expect(await store.get('d1')).toMatchObject({ documentId: 'd1' });
  });

  it('returns null for an unknown document', async () => {
    const store = createDocumentEvidenceStore({ repository: fakeRepository(), clock: () => 0 });
    expect(await store.get('missing')).toBeNull();
  });
});

describe('createDocumentEvidenceStore.getBlock', () => {
  it('returns the block at the given index', async () => {
    const store = createDocumentEvidenceStore({ repository: fakeRepository(), clock: () => 0 });
    await store.store(observation());
    expect(await store.getBlock('d1', 1)).toEqual({ text: 'B' });
  });

  it('returns null for an out-of-range index', async () => {
    const store = createDocumentEvidenceStore({ repository: fakeRepository(), clock: () => 0 });
    await store.store(observation());
    expect(await store.getBlock('d1', 99)).toBeNull();
  });
});

describe('createDocumentEvidenceStore: block selection (controls what may reach RAG/export)', () => {
  it('a block is not selected until explicitly marked', async () => {
    const store = createDocumentEvidenceStore({ repository: fakeRepository(), clock: () => 0 });
    await store.store(observation());
    expect(await store.isSelected('d1', 0)).toBe(false);
  });

  it('markSelected records the given block indexes, deduplicated', async () => {
    const store = createDocumentEvidenceStore({ repository: fakeRepository(), clock: () => 0 });
    await store.store(observation());
    await store.markSelected('d1', [0]);
    await store.markSelected('d1', [0, 1]);
    expect(await store.listSelected('d1')).toEqual([0, 1]);
    expect(await store.isSelected('d1', 1)).toBe(true);
  });

  it('rejects marking a selection before the document has been parsed/stored', async () => {
    const store = createDocumentEvidenceStore({ repository: fakeRepository(), clock: () => 0 });
    await expect(store.markSelected('missing', [0])).rejects.toThrow('document_not_parsed');
  });

  it('an unselected OCR crop never appears in the selected list by default', async () => {
    const store = createDocumentEvidenceStore({ repository: fakeRepository(), clock: () => 0 });
    await store.store(observation({ blocks: [{ text: 'OCR crop', ocrCropDigest: 'sha256:abc' }] }));
    expect(await store.listSelected('d1')).toEqual([]);
  });
});
