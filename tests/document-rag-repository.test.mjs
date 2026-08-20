import { describe, expect, it, vi } from 'vitest';
import { createDocumentRagRepository } from '../src/documents/document-rag-repository.mjs';

function fakeJsonRepository() {
  const rows = new Map();
  return {
    rows,
    put: vi.fn(async (id, record) => rows.set(id, record)),
    list: vi.fn(async () => [...rows.values()]),
    delete: vi.fn(async (id) => rows.delete(id)),
  };
}

const encryptionKey = () => Buffer.alloc(32, 7);

describe('createDocumentRagRepository', () => {
  it('indexes chunks by documentId then counts and deletes only that document', async () => {
    const repository = fakeJsonRepository();
    const rag = createDocumentRagRepository({ repository, encryptionKey: encryptionKey(), idGenerator: (() => {
      let id = 0;
      return () => `chunk-${++id}`;
    })() });

    await rag.indexChunk({ documentId: 'd1', text: 'bloc un' });
    await rag.indexChunk({ documentId: 'd2', text: 'bloc deux' });
    await rag.indexChunk({ documentId: 'd1', text: 'bloc trois' });

    expect(await rag.countByDocument('d1')).toBe(2);
    expect(await rag.deleteByDocument('d1')).toBe(2);
    expect(await rag.countByDocument('d1')).toBe(0);
    expect(await rag.countByDocument('d2')).toBe(1);
    expect(repository.delete).toHaveBeenCalledWith('chunk-1');
    expect(repository.delete).toHaveBeenCalledWith('chunk-3');
  });

  it('stores encrypted chunk payloads instead of selected plaintext', async () => {
    const repository = fakeJsonRepository();
    const rag = createDocumentRagRepository({
      repository,
      encryptionKey: encryptionKey(),
      idGenerator: () => 'chunk-1',
    });

    await rag.indexChunk({ documentId: 'd1', digest: 'sha256:abc', locator: { page: 1 }, text: 'bloc confidentiel' });

    const record = repository.rows.get('chunk-1');
    expect(record).toMatchObject({ id: 'chunk-1', documentId: 'd1', digest: 'sha256:abc', locator: { page: 1 } });
    expect(record.payload).toMatchObject({ version: 1, ciphertext: expect.any(String), authTag: expect.any(String) });
    expect(JSON.stringify(record)).not.toContain('bloc confidentiel');
    expect(record.text).toBeUndefined();
  });

  it('rejects chunks without a stable document id', async () => {
    const rag = createDocumentRagRepository({ repository: fakeJsonRepository(), encryptionKey: encryptionKey() });

    await expect(rag.indexChunk({ text: 'orphelin' })).rejects.toThrow('document_rag_chunk_document_id_required');
  });

  it('requires a 32-byte encryption key for local RAG persistence', () => {
    expect(() => createDocumentRagRepository({ repository: fakeJsonRepository() }))
      .toThrow('document_rag_encryption_key_required');
    expect(() => createDocumentRagRepository({ repository: fakeJsonRepository(), encryptionKey: Buffer.alloc(8) }))
      .toThrow('document_rag_encryption_key_required');
  });
});
