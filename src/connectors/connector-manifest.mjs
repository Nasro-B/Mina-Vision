import { z } from 'zod';

export const CONNECTOR_TYPES = Object.freeze(['declarative-rest', 'declarative-mqtt', 'local-adapter', 'isolated-code']);
const CURRENT_MINA_VERSION = '1.0.0';
const FORBIDDEN_CAPABILITIES = new Set(['shell.raw', 'fs.raw', 'ipc.raw', 'keyring.raw']);

function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/u.exec(String(version ?? ''));
  if (!match) return null;
  return match.slice(1, 4).map(Number);
}

function compareVersions(a, b) {
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

// Intentionally loose (not strictObject): a `value` key must still parse successfully here so the
// business rule below can reject it with the specific manifest_secret_value_forbidden message,
// rather than a generic Zod unrecognized_keys error the caller cannot match on reliably.
const secretDeclarationSchema = z.object({ name: z.string().min(1).max(200) });

const manifestSchema = z.strictObject({
  connectorId: z.string().min(1).max(200),
  name: z.string().min(1).max(200),
  version: z.string().regex(/^\d+\.\d+\.\d+$/u),
  publisherId: z.string().min(1).max(200),
  type: z.enum(CONNECTOR_TYPES),
  capabilities: z.array(z.string().min(1).max(200)).max(50),
  networkAllowlist: z.array(z.string().min(1).max(300)).max(50),
  tlsRequired: z.boolean(),
  minMinaVersion: z.string().regex(/^\d+\.\d+\.\d+$/u),
  maxMinaVersion: z.string().regex(/^\d+\.\d+\.\d+$/u),
  signature: z.string().min(1),
  digest: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  publisherPublicKey: z.string().min(1),
  secrets: z.array(secretDeclarationSchema).max(20).default([]),
});

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

export function validateManifest(manifest) {
  const parsed = manifestSchema.parse(manifest);

  if (parsed.networkAllowlist.includes('*')) throw new Error('global_network_wildcard_forbidden');
  if (parsed.capabilities.some((capability) => FORBIDDEN_CAPABILITIES.has(capability))) throw new Error('raw_shell_forbidden');
  if (!parsed.tlsRequired) throw new Error('tls_disabled_forbidden');
  for (const raw of manifest.secrets ?? []) {
    if (Object.keys(raw).some((key) => key !== 'name')) throw new Error('manifest_secret_value_forbidden');
  }

  const min = parseVersion(parsed.minMinaVersion);
  const max = parseVersion(parsed.maxMinaVersion);
  const current = parseVersion(CURRENT_MINA_VERSION);
  if (!min || !max || compareVersions(min, max) > 0) throw new Error('manifest_version_range_invalid');
  if (compareVersions(current, min) < 0 || compareVersions(current, max) > 0) throw new Error('incompatible_mina_version');

  return deepFreeze(parsed);
}

export { CURRENT_MINA_VERSION };
