import { createHash } from 'node:crypto';

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

export function createDownloadService({ browserDownloadPort, filesystem, confirmationService = null, clock } = {}) {
  if (!browserDownloadPort?.download) throw new TypeError('download_service_browser_download_port_required');
  if (!filesystem?.writeFile || !filesystem?.exists) throw new TypeError('download_service_filesystem_required');
  if (!clock || (typeof clock !== 'function' && typeof clock.now !== 'function')) {
    throw new TypeError('download_service_clock_required');
  }
  const now = () => Number(typeof clock === 'function' ? clock() : clock.now());

  return Object.freeze({
    async download(proposal) {
      const { finalUrl, digest, destination } = proposal;
      if (typeof finalUrl !== 'string' || finalUrl.length === 0) throw new TypeError('download_proposal_url_required');
      if (typeof digest !== 'string' || digest.length === 0) throw new TypeError('download_proposal_digest_required');
      if (typeof destination !== 'string' || destination.length === 0) throw new TypeError('download_proposal_destination_required');
      if (confirmationService?.confirm) {
        const confirmation = await confirmationService.confirm({
          reason: `Télécharger le document vérifié vers ${destination} ?`,
          action: { name: 'documents.download', digest },
        });
        const approved = confirmation === true || (confirmation?.approved === true && confirmation.digest === digest);
        if (!approved) throw new Error('document_download_confirmation_refused');
      }

      if (await filesystem.exists(destination)) {
        const existingBytes = await filesystem.readFile?.(destination);
        if (existingBytes && sha256(existingBytes) === digest) {
          return Object.freeze({ destination, digest, status: 'already_present', downloadedAt: new Date(now()).toISOString() });
        }
        throw new Error('download_destination_already_exists');
      }

      const result = await browserDownloadPort.download({ url: finalUrl });
      const bytes = result?.bytes;
      if (!Buffer.isBuffer(bytes) && !(bytes instanceof Uint8Array)) throw new Error('download_result_invalid');
      const actualDigest = sha256(bytes);
      if (actualDigest !== digest) throw new Error('download_digest_mismatch');

      await filesystem.writeFile(destination, bytes, { flag: 'wx' });
      return Object.freeze({ destination, digest: actualDigest, status: 'completed', downloadedAt: new Date(now()).toISOString() });
    },
  });
}
