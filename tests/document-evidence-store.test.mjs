import { describe, expect, it } from 'vitest';
import { createDocumentEvidenceStore } from '../src/documents/document-evidence-store.mjs';

function fakeRepository() {
  const rows = new Map();
  return {
    rows,
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

  it('persists metadata only by default, never OCR text or extracted fields', async () => {
    const repository = fakeRepository();
    const store = createDocumentEvidenceStore({ repository, clock: () => 0 });
    await store.store(observation({
      blocks: [{
        text: 'Donnée OCR confidentielle',
        sourceOffset: { kind: 'ocr', page: 1, box: [10, 20, 30, 40], private: 'ne pas écrire' },
        confidence: 0.94,
      }],
      fields: [{ name: 'iban', value: 'FR761234567890', confidence: 1 }],
      tables: [{ cells: ['secret'] }],
    }));

    const persisted = repository.rows.get('d1').observation;
    expect(persisted).toEqual({
      documentId: 'd1', mediaType: 'application/pdf', pageCount: null,
      parserId: 'unknown', parserVersion: 'unknown', observedAt: null, confidence: null,
      blocks: [{ sourceOffset: { kind: 'ocr', page: 1, box: [10, 20, 30, 40] }, confidence: 0.94 }],
    });
    expect(JSON.stringify(persisted)).not.toContain('Donnée OCR confidentielle');
    expect(JSON.stringify(persisted)).not.toContain('FR761234567890');
    expect(JSON.stringify(persisted)).not.toContain('ne pas écrire');
  });

  it('retains full text only when a caller opts in explicitly', async () => {
    const store = createDocumentEvidenceStore({ repository: fakeRepository(), clock: () => 0, storageMode: 'full' });
    await store.store(observation());

    expect(await store.getBlock('d1', 1)).toEqual({ text: 'B' });
  });

  it('returns null for an unknown document', async () => {
    const store = createDocumentEvidenceStore({ repository: fakeRepository(), clock: () => 0 });
    expect(await store.get('missing')).toBeNull();
  });
});

describe('createDocumentEvidenceStore.getBlock', () => {
  it('returns the metadata-only block at the given index by default', async () => {
    const store = createDocumentEvidenceStore({ repository: fakeRepository(), clock: () => 0 });
    await store.store(observation({ blocks: [{
      text: 'B', sourceOffset: { kind: 'pdf_text', page: 1, start: 0, end: 1 }, confidence: 1,
    }] }));
    expect(await store.getBlock('d1', 0)).toEqual({
      sourceOffset: { kind: 'pdf_text', page: 1, start: 0, end: 1 }, confidence: 1,
    });
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
