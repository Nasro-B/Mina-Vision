function diffManifests(fromManifest, toManifest) {
  const fromCapabilities = new Set(fromManifest?.capabilities ?? []);
  const toCapabilities = new Set(toManifest?.capabilities ?? []);
  const fromHosts = new Set(fromManifest?.networkAllowlist ?? []);
  const toHosts = new Set(toManifest?.networkAllowlist ?? []);
  const addedCapabilities = [...toCapabilities].filter((capability) => !fromCapabilities.has(capability));
  const removedCapabilities = [...fromCapabilities].filter((capability) => !toCapabilities.has(capability));
  const addedHosts = [...toHosts].filter((host) => !fromHosts.has(host));
  const removedHosts = [...fromHosts].filter((host) => !toHosts.has(host));
  return Object.freeze({
    addedCapabilities: Object.freeze(addedCapabilities),
    removedCapabilities: Object.freeze(removedCapabilities),
    addedHosts: Object.freeze(addedHosts),
    removedHosts: Object.freeze(removedHosts),
  });
}

export function createConnectorVersionService({ installer, registry, trustStore, clock } = {}) {
  if (!installer?.importPackage || !installer?.install) throw new TypeError('connector_version_service_installer_required');
  if (!registry?.register) throw new TypeError('connector_version_service_registry_required');
  if (!trustStore?.isApproved) throw new TypeError('connector_version_service_trust_store_required');
  if (!clock || (typeof clock !== 'function' && typeof clock.now !== 'function')) {
    throw new TypeError('connector_version_service_clock_required');
  }
  const now = () => Number(typeof clock === 'function' ? clock() : clock.now());
  const connectorStates = new Map();

  function requireState(connectorId) {
    const state = connectorStates.get(connectorId);
    if (!state) throw new Error('connector_not_installed');
    return state;
  }

  return Object.freeze({
    // Stages a new package for an already-known (or first-time) connectorId. Never activates it —
    // the current active version (if any) keeps serving traffic until activateVersion succeeds.
    async stageUpdate(packagePath) {
      const job = await installer.importPackage(packagePath);
      const manifest = job.manifest;

      const approved = await trustStore.isApproved(manifest.publisherId);
      if (!approved) throw new Error('connector_publisher_not_approved');

      const existing = connectorStates.get(manifest.connectorId) ?? null;
      const permissionDiff = diffManifests(existing?.activeManifest ?? null, manifest);
      const requiresLocalConfirmation = permissionDiff.addedCapabilities.length > 0 || permissionDiff.addedHosts.length > 0;

      const staged = Object.freeze({
        jobId: job.jobId, manifest, permissionDiff, requiresLocalConfirmation, stagedAt: new Date(now()).toISOString(),
      });
      connectorStates.set(manifest.connectorId, Object.freeze({
        activeManifest: existing?.activeManifest ?? null,
        activeJobId: existing?.activeJobId ?? null,
        activeActivatedAt: existing?.activeActivatedAt ?? null,
        history: existing?.history ?? Object.freeze([]),
        staged,
      }));

      return Object.freeze({
        jobId: job.jobId, connectorId: manifest.connectorId, manifest, permissionDiff, requiresLocalConfirmation,
      });
    },

    // Returns the permission diff of the currently-staged version against the active one, without
    // mutating anything — lets a caller (e.g. the approvals UI) show the diff before confirming.
    permissionDiff(connectorId) {
      const state = requireState(connectorId);
      if (!state.staged) throw new Error('connector_no_staged_version');
      return state.staged.permissionDiff;
    },

    // Flips the active-version pointer in a single atomic Map write. Requires local confirmation
    // whenever the staged version adds a capability or network host beyond what's already active.
    async activateVersion(connectorId, { confirmed = false } = {}) {
      const state = requireState(connectorId);
      if (!state.staged) throw new Error('connector_no_staged_version');
      if (state.staged.requiresLocalConfirmation && !confirmed) {
        throw new Error('connector_version_confirmation_required');
      }

      await installer.install(state.staged.jobId);

      const previous = state.activeManifest
        ? Object.freeze({ jobId: state.activeJobId, manifest: state.activeManifest, activatedAt: state.activeActivatedAt })
        : null;
      const history = previous ? Object.freeze([...state.history, previous]) : state.history;
      const activatedAt = new Date(now()).toISOString();

      connectorStates.set(connectorId, Object.freeze({
        activeManifest: state.staged.manifest, activeJobId: state.staged.jobId, activeActivatedAt: activatedAt,
        history, staged: null,
      }));

      return Object.freeze({ connectorId, version: state.staged.manifest.version, activatedAt });
    },

    // Reverts the active-version pointer to the immediately-previous version, in one atomic write.
    async rollback(connectorId) {
      const state = requireState(connectorId);
      if (state.history.length === 0) throw new Error('connector_no_previous_version');
      const previous = state.history[state.history.length - 1];
      const rolledBackAt = new Date(now()).toISOString();

      connectorStates.set(connectorId, Object.freeze({
        activeManifest: previous.manifest, activeJobId: previous.jobId, activeActivatedAt: previous.activatedAt,
        history: Object.freeze(state.history.slice(0, -1)), staged: null,
      }));

      return Object.freeze({ connectorId, version: previous.manifest.version, rolledBackAt });
    },

    getActive(connectorId) {
      return connectorStates.get(connectorId)?.activeManifest ?? null;
    },
  });
}
