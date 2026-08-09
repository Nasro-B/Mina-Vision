import { randomUUID } from 'node:crypto';
import { quarantineAttachment } from '../mail/attachment-quarantine.mjs';
import { validateDocumentItem } from './document-contracts.mjs';

export function createDocumentIntake({
  quarantineStore, filesystem, realpathProvider, antivirus = null, capabilityBroker = null, clock,
} = {}) {
  if (!quarantineStore?.putRecord || !quarantineStore?.writeBytes) throw new TypeError('document_intake_quarantine_store_required');
  if (!filesystem?.readFile) throw new TypeError('document_intake_filesystem_required');
  if (!realpathProvider?.resolve || !realpathProvider?.resolveDestination) throw new TypeError('document_intake_realpath_provider_required');
  if (!clock || (typeof clock !== 'function' && typeof clock.now !== 'function')) {
    throw new TypeError('document_intake_clock_required');
  }
  const now = () => Number(typeof clock === 'function' ? clock() : clock.now());

  return Object.freeze({
    async intake({ source, path = null, bytes = null, declaredName, signal } = {}) {
      signal?.throwIfAborted();
      let payload = bytes;
      if (!payload) {
        if (typeof path !== 'string' || path.length === 0) throw new TypeError('document_intake_source_required');
        const realPath = await realpathProvider.resolve(path);
        payload = await filesystem.readFile(realPath, { signal });
      }
      if (!Buffer.isBuffer(payload) && !(payload instanceof Uint8Array)) throw new TypeError('document_intake_bytes_invalid');
      const buffer = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);

      const verdict = await quarantineAttachment({ bytes: buffer, declaredFilename: declaredName });
      const existing = await quarantineStore.findByDigest(verdict.digest);
      if (existing) return existing;

      let status = verdict.status;
      const reasons = [...verdict.reasons];
      if (status === 'inspectable' && antivirus) {
        try {
          const scan = await antivirus.scan(buffer);
          if (scan?.infected) { status = 'quarantined'; reasons.push('antivirus_flagged'); }
        } catch {
          // Antivirus unavailable never downgrades or upgrades a signature-based verdict; it stays as detected.
        }
      }

      const documentId = randomUUID();
      await quarantineStore.writeBytes(documentId, buffer);
      return quarantineStore.putRecord({
        documentId, digest: verdict.digest, source: source ?? 'unknown', declaredName: declaredName ?? '',
        detectedType: verdict.detectedType, size: buffer.length, status,
        reasons, observedAt: new Date(now()).toISOString(),
      });
    },

    async inspect(documentId) {
      return quarantineStore.getRecord(documentId);
    },

    async promote(documentId, destination) {
      const record = await quarantineStore.getRecord(documentId);
      if (!record) throw new Error('document_not_found');
      if (record.status === 'blocked') throw new Error('document_promotion_blocked');
      if (capabilityBroker) {
        const decision = await capabilityBroker.authorize({ capability: 'documents.promote', resource: documentId, effect: 'write' });
        if (decision.decision !== 'allow') throw new Error(decision.reason ?? 'document_promotion_denied');
      }
      const realDestination = await realpathProvider.resolveDestination(destination);
      const bytes = await quarantineStore.readBytes(documentId);
      await filesystem.writeFile(realDestination, bytes, { flag: 'wx' });
      return Object.freeze({ promoted: true, destination: realDestination, documentId });
    },
  });
}

export { validateDocumentItem };
