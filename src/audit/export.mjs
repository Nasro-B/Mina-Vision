import AdmZip from 'adm-zip';
import { sha256 } from '../crypto/digest.mjs';

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;

export function createAuditExport({ diagnostics, filesystem, clock } = {}) {
  if (!diagnostics?.buildReport) throw new TypeError('audit_export_diagnostics_required');
  if (!filesystem?.writeFile) throw new TypeError('audit_export_filesystem_required');
  if (!clock || (typeof clock !== 'function' && typeof clock.now !== 'function')) {
    throw new TypeError('audit_export_clock_required');
  }
  const now = () => Number(typeof clock === 'function' ? clock() : clock.now());

  return Object.freeze({
    // Only ever built on an explicit caller request — never automatically. The archive contains
    // strictly the redacted diagnostics report (no memory/secret/body content, per diagnostics.mjs).
    async exportDiagnostics({ sessionId, destination, maxBytes = DEFAULT_MAX_BYTES } = {}) {
      const report = await diagnostics.buildReport({ sessionId });
      const zip = new AdmZip();
      zip.addFile('report.json', Buffer.from(JSON.stringify({ ...report, exportedAt: new Date(now()).toISOString() }, null, 2)));
      const bytes = zip.toBuffer();
      if (bytes.length > maxBytes) throw new Error('audit_export_too_large');
      await filesystem.writeFile(destination, bytes);
      return Object.freeze({ path: destination, digest: `sha256:${sha256(bytes)}`, byteSize: bytes.length });
    },
  });
}
