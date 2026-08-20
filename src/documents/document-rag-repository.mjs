import { randomUUID } from 'node:crypto';
import { createAad, encryptAead } from '../crypto/aead.mjs';

function requireDocumentId(documentId) {
  const value = String(documentId ?? '').trim();
  if (!value) throw new TypeError('document_rag_chunk_document_id_required');
  return value;
}

function validateEncryptionKey(encryptionKey) {
  const key = Buffer.from(encryptionKey ?? []);
  if (key.length !== 32) throw new TypeError('document_rag_encryption_key_required');
  return key;
}

function encryptChunkPayload({ key, id, chunk }) {
  const plaintext = Buffer.from(JSON.stringify({ text: String(chunk?.text ?? '') }), 'utf8');
  try {
    return encryptAead({
      key,
      plaintext,
      aad: createAad({ version: 1, type: 'document_rag_chunk', id }),
    });
  } finally {
    plaintext.fill(0);
  }
}

export function createDocumentRagRepository({
  repository, encryptionKey = null, getEncryptionKey = null, idGenerator = randomUUID,
} = {}) {
  if (!repository?.put || !repository?.list || !repository?.delete) throw new TypeError('document_rag_repository_required');
  if (typeof idGenerator !== 'function') throw new TypeError('document_rag_id_generator_required');
  if (getEncryptionKey !== null && typeof getEncryptionKey !== 'function') throw new TypeError('document_rag_encryption_key_provider_required');
  if (!getEncryptionKey) validateEncryptionKey(encryptionKey).fill(0);

  return Object.freeze({
    async indexChunk(chunk) {
      const documentId = requireDocumentId(chunk?.documentId);
      const id = idGenerator();
      const key = validateEncryptionKey(getEncryptionKey ? getEncryptionKey() : encryptionKey);
      try {
        await repository.put(id, Object.freeze({
          id,
          documentId,
          digest: chunk?.digest ?? null,
          locator: chunk?.locator ?? null,
          classification: chunk?.classification ?? null,
          project: chunk?.project ?? null,
          category: chunk?.category ?? null,
          indexedAt: chunk?.indexedAt ?? null,
          payload: encryptChunkPayload({ key, id, chunk }),
        }));
      } finally {
        key.fill(0);
      }
      return Object.freeze({ id, documentId });
    },
    async countByDocument(documentId) {
      const target = requireDocumentId(documentId);
      const rows = await repository.list();
      return rows.filter((row) => row?.documentId === target).length;
    },
    async deleteByDocument(documentId) {
      const target = requireDocumentId(documentId);
      const rows = await repository.list();
      const matching = rows.filter((row) => row?.documentId === target && row?.id);
      for (const row of matching) {
        // eslint-disable-next-line no-await-in-loop
        await repository.delete(row.id);
      }
      return matching.length;
    },
  });
}
