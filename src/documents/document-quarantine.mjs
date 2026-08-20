import { validateDocumentItem } from './document-contracts.mjs';

export function createDocumentQuarantineStore({ filesystem, repository, quarantineDir = 'quarantine' } = {}) {
  if (!filesystem?.writeFile || !filesystem?.readFile) throw new TypeError('document_quarantine_filesystem_required');
  if (!repository?.put || !repository?.get || !repository?.list) throw new TypeError('document_quarantine_repository_required');

  function pathFor(documentId) {
    return `${quarantineDir}/${documentId}`;
  }

  return Object.freeze({
    async writeBytes(documentId, bytes) {
      await filesystem.writeFile(pathFor(documentId), bytes, { mode: 0o600 });
      return pathFor(documentId);
    },

    async readBytes(documentId) {
      return filesystem.readFile(pathFor(documentId));
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
