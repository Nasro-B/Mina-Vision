import { createAad, decryptAead, encryptAead } from '../crypto/aead.mjs';
import { validateDocumentItem } from './document-contracts.mjs';

const ENCRYPTED_SOURCE_PREFIX = Buffer.from('MINA-DOCQ-AEAD-1\n', 'utf8');

function validateEncryptionKey(encryptionKey) {
  const key = Buffer.from(encryptionKey ?? []);
  if (key.length !== 32) throw new TypeError('document_quarantine_encryption_key_required');
  return key;
}

function sourceAad(documentId) {
  return createAad({ version: 1, type: 'document_quarantine_source', id: documentId });
}

function isEncryptedSource(bytes) {
  const stored = Buffer.from(bytes ?? []);
  return stored.length > ENCRYPTED_SOURCE_PREFIX.length
    && stored.subarray(0, ENCRYPTED_SOURCE_PREFIX.length).equals(ENCRYPTED_SOURCE_PREFIX);
}

function serializeEncryptedSource(envelope) {
  return Buffer.concat([
    ENCRYPTED_SOURCE_PREFIX,
    Buffer.from(JSON.stringify(envelope), 'utf8'),
  ]);
}

function parseEncryptedSource(bytes) {
  return JSON.parse(Buffer.from(bytes).subarray(ENCRYPTED_SOURCE_PREFIX.length).toString('utf8'));
}

export function createDocumentQuarantineStore({
  filesystem, repository, quarantineDir = 'quarantine', encryptionKey = null, getEncryptionKey = null,
} = {}) {
  if (!filesystem?.writeFile || !filesystem?.readFile) throw new TypeError('document_quarantine_filesystem_required');
  if (!repository?.put || !repository?.get || !repository?.list) throw new TypeError('document_quarantine_repository_required');
  if (getEncryptionKey !== null && typeof getEncryptionKey !== 'function') throw new TypeError('document_quarantine_encryption_key_provider_required');
  if (encryptionKey !== null) validateEncryptionKey(encryptionKey).fill(0);

  function pathFor(documentId) {
    return `${quarantineDir}/${documentId}`;
  }

  function resolveEncryptionKey() {
    if (getEncryptionKey) return validateEncryptionKey(getEncryptionKey());
    if (encryptionKey !== null) return validateEncryptionKey(encryptionKey);
    return null;
  }

  return Object.freeze({
    async writeBytes(documentId, bytes) {
      const key = resolveEncryptionKey();
      if (!key) {
        await filesystem.writeFile(pathFor(documentId), bytes, { mode: 0o600 });
        return pathFor(documentId);
      }
      const plaintext = Buffer.from(bytes);
      try {
        const envelope = encryptAead({
          key,
          plaintext,
          aad: sourceAad(documentId),
        });
        await filesystem.writeFile(pathFor(documentId), serializeEncryptedSource(envelope), { mode: 0o600 });
      } finally {
        plaintext.fill(0);
        key.fill(0);
      }
      return pathFor(documentId);
    },

    async readBytes(documentId) {
      const stored = await filesystem.readFile(pathFor(documentId));
      if (!isEncryptedSource(stored)) return stored;
      const key = resolveEncryptionKey();
      if (!key) throw new TypeError('document_quarantine_encryption_key_required');
      try {
        return decryptAead({
          key,
          envelope: parseEncryptedSource(stored),
          aad: sourceAad(documentId),
        });
      } finally {
        key.fill(0);
      }
    },

    async deleteBytes(documentId) {
      if (typeof filesystem.rm !== 'function') throw new TypeError('document_quarantine_delete_bytes_unsupported');
      await filesystem.rm(pathFor(documentId), { force: true });
      return true;
    },

    async putRecord(item) {
      const validated = validateDocumentItem(item);
      await repository.put(validated.documentId, validated);
      return validated;
    },

    async getRecord(documentId) {
      return (await repository.get(documentId)) ?? null;
    },

    async deleteRecord(documentId) {
      if (typeof repository.delete !== 'function') throw new TypeError('document_quarantine_delete_record_unsupported');
      return repository.delete(documentId);
    },

    async listRecords() {
      return Object.freeze(await repository.list());
    },

    async findByDigest(digest) {
      const all = await repository.list();
      return all.find((item) => item.digest === digest) ?? null;
    },
  });
}
