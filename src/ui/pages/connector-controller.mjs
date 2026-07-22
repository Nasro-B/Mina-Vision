// Explicit allowlist projection: only fields safe for an admin list view. `manifest.secrets` (secret
// NAME declarations), `signature` and `publisherPublicKey` are deliberately never spread through —
// this list is enumerated by hand so a future manifest field can never leak by default.
function redactConnector(entry, activeVersion) {
  return Object.freeze({
    connectorId: entry.connectorId,
    name: entry.manifest.name,
    publisherId: entry.manifest.publisherId,
    type: entry.manifest.type,
    capabilities: Object.freeze([...(entry.manifest.capabilities ?? [])]),
    networkAllowlist: Object.freeze([...(entry.manifest.networkAllowlist ?? [])]),
    digest: entry.manifest.digest,
    version: activeVersion?.version ?? entry.manifest.version,
    registeredAt: entry.registeredAt,
  });
}

function redactPublisherTrust(trust) {
  if (!trust) return null;
  return Object.freeze({
    publisherId: trust.publisherId, fingerprint: trust.fingerprint, approvedAt: trust.approvedAt,
    revoked: trust.revoked ?? false, revokedAt: trust.revokedAt ?? null,
  });
}

export function createConnectorController({ installer, registry, trustStore, versionService = null, revocationService = null } = {}) {
  if (!installer?.importPackage || !installer?.install || !installer?.approvePublisher) {
    throw new TypeError('connector_controller_installer_required');
  }
  if (!registry?.list) throw new TypeError('connector_controller_registry_required');
  if (!trustStore?.isApproved || !trustStore?.getTrust) throw new TypeError('connector_controller_trust_store_required');

  return Object.freeze({
    importPackage: (path) => installer.importPackage(path),
    inspectJob: (jobId) => installer.inspect(jobId),
    install: (jobId) => installer.install(jobId),
    approvePublisher: (input) => installer.approvePublisher(input),

    // Digests/permissions/versions displayed; never a secret field (installed/activated connectors
    // only — this is the admin "Connecteurs" list, sourced from the real registry, never the raw
    // manifest object).
    async list() {
      const entries = await registry.list();
      return entries.map((entry) => redactConnector(entry, versionService?.getActive(entry.connectorId) ?? null));
    },

    // Backs the "Éditeurs approuvés" page: approval/revocation state only, never the stored public key.
    async publisherTrust(publisherId) {
      return redactPublisherTrust(await trustStore.getTrust(publisherId));
    },

    stageUpdate: (path) => {
      if (!versionService) throw new Error('connector_version_service_not_configured');
      return versionService.stageUpdate(path);
    },
    permissionDiff: (connectorId) => {
      if (!versionService) throw new Error('connector_version_service_not_configured');
      return versionService.permissionDiff(connectorId);
    },
    // Publisher approval and connector activation stay main-process/local: this controller exposes
    // them for the main process to call, but nothing here ever runs the confirmation over IPC from
    // a remote channel — remote approvals go through approval-controller.remoteApprove instead.
    activateVersion: (connectorId, options) => {
      if (!versionService) throw new Error('connector_version_service_not_configured');
      return versionService.activateVersion(connectorId, options);
    },
    rollbackVersion: (connectorId) => {
      if (!versionService) throw new Error('connector_version_service_not_configured');
      return versionService.rollback(connectorId);
    },

    revokePublisher: (publisherId) => {
      if (!revocationService) throw new Error('connector_revocation_service_not_configured');
      return revocationService.revokePublisher(publisherId);
    },
  });
}
