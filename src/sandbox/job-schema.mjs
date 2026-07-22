import { createHash } from 'node:crypto';

export const SANDBOX_PROFILES = Object.freeze({
  small: Object.freeze({ wallMs: 30_000, memoryMiB: 256, outputBytes: 1024 * 1024 }),
  standard: Object.freeze({ wallMs: 120_000, memoryMiB: 512, outputBytes: 5 * 1024 * 1024 }),
  large: Object.freeze({ wallMs: 300_000, memoryMiB: 1024, outputBytes: 10 * 1024 * 1024 }),
});

const JOB_FIELDS = Object.freeze(['args', 'entrypoint', 'exports', 'language', 'limits', 'network', 'profile', 'sourceFiles']);
const SOURCE_FIELDS = Object.freeze(['digest', 'mode', 'path']);
const LIMIT_FIELDS = Object.freeze(['memoryMiB', 'outputBytes', 'wallMs']);
const EXTENSIONS = Object.freeze({ python: '.py', javascript: '.js', powershell: '.ps1' });
const DIGEST = /^sha256:[a-f0-9]{64}$/u;

function exactKeys(value, keys, error) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) throw new TypeError(error);
}

function safePath(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 300 || value.includes('\\')
    || value.startsWith('/') || /^[a-z]:/iu.test(value)
    || value.split('/').some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new TypeError('sandbox_path_invalid');
  }
  return value;
}

function normalizedSources(sourceFiles) {
  if (!Array.isArray(sourceFiles) || sourceFiles.length < 1 || sourceFiles.length > 100) throw new TypeError('sandbox_sources_invalid');
  const paths = new Set();
  const sources = sourceFiles.map((source) => {
    exactKeys(source, SOURCE_FIELDS, 'sandbox_source_fields_invalid');
    const path = safePath(source.path);
    if (paths.has(path)) throw new TypeError('sandbox_source_duplicate');
    paths.add(path);
    if (!DIGEST.test(source.digest ?? '') || source.mode !== 'read-only') throw new TypeError('sandbox_source_invalid');
    return Object.freeze({ path, digest: source.digest, mode: 'read-only' });
  });
  return Object.freeze(sources);
}

export function createSandboxSourceDigest(sourceFiles) {
  const sources = normalizedSources(sourceFiles);
  const hash = createHash('sha256');
  for (const source of [...sources].sort((a, b) => a.path.localeCompare(b.path))) {
    hash.update(source.path).update('\0').update(source.digest).update('\0').update(source.mode).update('\0');
  }
  return `sha256:${hash.digest('hex')}`;
}

export function parseSandboxJob(input, context = {}) {
  exactKeys(input, JOB_FIELDS, 'sandbox_job_fields_invalid');
  if (!['local', 'voice'].includes(context.channel)) throw new Error(`sandbox_channel_forbidden:${context.channel}`);
  if (context.explicitExecution !== true) throw new Error('sandbox_explicit_execution_required');
  if (!Object.hasOwn(EXTENSIONS, input.language)) throw new TypeError('sandbox_language_invalid');
  if (!Object.hasOwn(SANDBOX_PROFILES, input.profile)) throw new TypeError('sandbox_profile_invalid');
  if (input.network !== false) throw new Error('sandbox_network_forbidden');
  const sourceFiles = normalizedSources(input.sourceFiles);
  const sourceDigest = createSandboxSourceDigest(sourceFiles);
  if (!context.sourceConfirmation?.approved || typeof context.sourceConfirmation.token !== 'string'
    || !context.sourceConfirmation.token) throw new Error('sandbox_source_confirmation_required');
  if (context.sourceConfirmation.digest !== sourceDigest) throw new Error('sandbox_source_confirmation_invalid');
  const entrypoint = safePath(input.entrypoint);
  if (!sourceFiles.some((source) => source.path === entrypoint)) throw new Error('sandbox_entrypoint_not_in_sources');
  if (!entrypoint.toLowerCase().endsWith(EXTENSIONS[input.language])) throw new Error('sandbox_entrypoint_extension_invalid');
  if (!Array.isArray(input.args) || input.args.length > 100
    || input.args.some((arg) => typeof arg !== 'string' || arg.length > 2_000 || arg.includes('\0'))) {
    throw new TypeError('sandbox_args_invalid');
  }
  if (!Array.isArray(input.exports) || input.exports.length > 100) throw new TypeError('sandbox_exports_invalid');
  const exports = input.exports.map((path) => {
    const safe = safePath(path);
    if (!safe.startsWith('out/')) throw new Error('sandbox_export_outside_output');
    return safe;
  });
  exactKeys(input.limits, LIMIT_FIELDS, 'sandbox_limits_invalid');
  const profile = SANDBOX_PROFILES[input.profile];
  for (const key of LIMIT_FIELDS) {
    const value = input.limits[key];
    if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`sandbox_limit_invalid:${key}`);
    if (value > profile[key]) throw new Error(`sandbox_limit_exceeded:${key}`);
  }
  if (input.profile === 'large' && (!context.largeConfirmation?.approved || typeof context.largeConfirmation.token !== 'string'
    || !context.largeConfirmation.token)) throw new Error('sandbox_large_confirmation_required');
  return Object.freeze({
    language: input.language,
    sourceFiles,
    entrypoint,
    args: Object.freeze([...input.args]),
    profile: input.profile,
    limits: Object.freeze({ ...input.limits }),
    network: false,
    exports: Object.freeze(exports),
    sourceDigest,
    sourceConfirmationToken: context.sourceConfirmation.token,
  });
}
