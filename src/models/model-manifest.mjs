import path from 'node:path';

export const MODEL_ROLES = Object.freeze([
  'text', 'reasoning', 'embedding', 'ocr', 'vision', 'stt', 'tts', 'computer-use',
  'face-detection', 'face-recognition',
]);
const ROLE_SET = new Set(MODEL_ROLES);
const RUNTIMES = new Set(['lm-studio', 'transformers-js', 'onnx', 'local-process']);

function within(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

export function validateModelManifest(manifest, workspaceRoot) {
  if (!manifest?.id || !/^[a-z0-9][a-z0-9._-]{0,127}$/u.test(manifest.id)) throw new TypeError('model_manifest_id_invalid');
  if (!ROLE_SET.has(manifest.role)) throw new TypeError('model_manifest_role_invalid');
  if (!manifest.source || !manifest.revision) throw new TypeError('model_manifest_source_invalid');
  if (!/^[a-f0-9]{64}$/iu.test(manifest.sha256 ?? '')) throw new TypeError('model_manifest_checksum_invalid');
  if (!manifest.license || typeof manifest.license !== 'string') throw new TypeError('model_manifest_license_invalid');
  if (!Number.isFinite(manifest.estimatedRamMb) || manifest.estimatedRamMb <= 0) throw new TypeError('model_manifest_ram_invalid');
  if (!RUNTIMES.has(manifest.runtime)) throw new TypeError('model_manifest_runtime_invalid');
  if (!manifest.path || path.isAbsolute(manifest.path)) throw new TypeError('model_manifest_path_invalid');
  const root = path.resolve(workspaceRoot);
  const installPath = path.resolve(root, manifest.path);
  if (!within(root, installPath)) throw new TypeError('model_manifest_path_escape');
  return Object.freeze({ ...structuredClone(manifest), installPath });
}
