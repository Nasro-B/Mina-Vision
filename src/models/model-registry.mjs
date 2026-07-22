import path from 'node:path';
import { MODEL_ROLES, validateModelManifest } from './model-manifest.mjs';

const ROLE_SET = new Set(MODEL_ROLES);

export function createModelRegistry({ workspaceRoot, manifests = [], clock = Date.now } = {}) {
  if (!workspaceRoot) throw new TypeError('model_workspace_root_required');
  const records = new Map();
  for (const candidate of manifests) {
    const manifest = validateModelManifest(candidate, workspaceRoot);
    if (records.has(manifest.id)) throw new Error(`model_manifest_duplicate:${manifest.id}`);
    records.set(manifest.id, { manifest, state: 'missing', updatedAt: Number(clock()) });
  }

  function snapshot(record) {
    return Object.freeze({
      ...record.manifest,
      state: record.state,
      updatedAt: record.updatedAt,
      ...(record.error ? { error: record.error } : {}),
    });
  }

  function recordFor(id) {
    const record = records.get(id);
    if (!record) throw new Error(`model_unknown:${id}`);
    return record;
  }

  function list() {
    return Object.freeze([...records.values()].map(snapshot));
  }

  function markInstalled(id, installedPath) {
    const record = recordFor(id);
    if (!['missing', 'failed', 'installed'].includes(record.state)) throw new Error('model_state_transition_invalid');
    if (path.resolve(installedPath) !== record.manifest.installPath) throw new Error('model_install_path_mismatch');
    record.state = 'installed';
    record.updatedAt = Number(clock());
    delete record.error;
    return snapshot(record);
  }

  function markLoaded(id) {
    const record = recordFor(id);
    if (record.state !== 'installed' && record.state !== 'loaded') throw new Error('model_state_transition_invalid');
    record.state = 'loaded';
    record.updatedAt = Number(clock());
    return snapshot(record);
  }

  function markFailed(id, error) {
    const record = recordFor(id);
    record.state = 'failed';
    record.error = String(error?.message || error || 'unknown_failure').slice(0, 300);
    record.updatedAt = Number(clock());
    return snapshot(record);
  }

  function resolve(role, constraints = {}) {
    if (!ROLE_SET.has(role)) throw new Error(`model_role_invalid:${role}`);
    const candidates = [...records.values()]
      .filter((record) => record.manifest.role === role)
      .filter((record) => ['installed', 'loaded'].includes(record.state))
      .filter((record) => !constraints.runtime || record.manifest.runtime === constraints.runtime)
      .filter((record) => !Number.isFinite(constraints.maxRamMb) || record.manifest.estimatedRamMb <= constraints.maxRamMb)
      .sort((left, right) => Number(right.state === 'loaded') - Number(left.state === 'loaded')
        || left.manifest.estimatedRamMb - right.manifest.estimatedRamMb
        || left.manifest.id.localeCompare(right.manifest.id));
    if (!candidates.length) throw new Error(`model_role_unavailable:${role}`);
    return snapshot(candidates[0]);
  }

  return Object.freeze({ list, resolve, markInstalled, markLoaded, markFailed });
}
