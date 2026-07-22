import { randomUUID } from 'node:crypto';
import { validateManifest } from './connector-manifest.mjs';

export function createConnectorInstaller({ trustStore, zipInspector, dependencyScanner, filesystem, clock } = {}) {
  if (!trustStore?.isApproved || !trustStore?.approvePublisher || !trustStore?.verifySignature) {
    throw new TypeError('connector_installer_trust_store_required');
  }
  if (!zipInspector?.inspect) throw new TypeError('connector_installer_zip_inspector_required');
  if (!dependencyScanner?.scan) throw new TypeError('connector_installer_dependency_scanner_required');
  if (!filesystem?.readFile || !filesystem?.writeFile) throw new TypeError('connector_installer_filesystem_required');
  if (!clock || (typeof clock !== 'function' && typeof clock.now !== 'function')) {
    throw new TypeError('connector_installer_clock_required');
  }
  const now = () => Number(typeof clock === 'function' ? clock() : clock.now());
  const jobs = new Map();

  return Object.freeze({
    async importPackage(path) {
      const bytes = await filesystem.readFile(path);
      const inspection = await zipInspector.inspect(bytes);
      if (!inspection?.valid) throw new Error(inspection?.reason ?? 'connector_package_invalid');

      const manifest = validateManifest(JSON.parse(inspection.manifestText));

      if (inspection.packageDigest !== manifest.digest) throw new Error('package_digest_mismatch');
      const signatureValid = await trustStore.verifySignature({
        publicKey: manifest.publisherPublicKey, digest: manifest.digest, signature: manifest.signature,
      });
      if (!signatureValid) throw new Error('package_signature_invalid');

      const dependencyFindings = await dependencyScanner.scan(manifest);
      const approved = await trustStore.isApproved(manifest.publisherId);

      const jobId = randomUUID();
      await filesystem.writeFile(`connectors/quarantine/${jobId}.zip`, bytes);
      const job = Object.freeze({
        jobId, manifest, dependencyFindings: Object.freeze(dependencyFindings ?? []),
        status: approved ? 'ready_to_install' : 'quarantined_unknown_publisher',
        importedAt: new Date(now()).toISOString(),
      });
      jobs.set(jobId, job);
      return job;
    },

    async inspect(jobId) {
      const job = jobs.get(jobId);
      if (!job) throw new Error('connector_job_not_found');
      return job;
    },

    approvePublisher: (input) => trustStore.approvePublisher(input),

    async install(jobId) {
      const job = jobs.get(jobId);
      if (!job) throw new Error('connector_job_not_found');
      if (job.status === 'installed') return job;

      const approved = await trustStore.isApproved(job.manifest.publisherId);
      if (!approved) throw new Error('connector_publisher_not_approved');

      const installed = Object.freeze({ ...job, status: 'installed', installedAt: new Date(now()).toISOString() });
      jobs.set(jobId, installed);
      return installed;
    },
  });
}
