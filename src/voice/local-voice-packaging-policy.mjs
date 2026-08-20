const ELECTRON_INSTALLER_GATE = 'electron_installer_gpl_source_obligation_open';
const ALLOWED_CURRENT_ARTIFACTS = new Set(['source-repository', 'android-apk']);

export function evaluateLocalVoicePackaging({ artifact } = {}) {
  if (ALLOWED_CURRENT_ARTIFACTS.has(artifact)) {
    return Object.freeze({ artifact, status: 'allowed', reason: null });
  }
  if (artifact === 'electron-bundled-installer') {
    return Object.freeze({ artifact, status: 'blocked', reason: ELECTRON_INSTALLER_GATE });
  }
  throw new TypeError('local_voice_packaging_artifact_invalid');
}

export function localVoicePackagingCapability() {
  return Object.freeze({
    id: 'packaging.local_voice',
    status: 'degraded',
    reason: ELECTRON_INSTALLER_GATE,
  });
}
