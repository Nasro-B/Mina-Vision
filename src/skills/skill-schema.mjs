import { parseDocument } from 'yaml';

const MAX_SKILL_BYTES = 256 * 1024;
const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/u;
const SEMVER = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/u;
const DIGEST = /^sha256:(?:[a-f0-9]{64}|manifest-placeholder)$/u;
const REQUIRED_KEYS = Object.freeze([
  'budgets', 'capabilities', 'channels', 'compatibility', 'description',
  'digest', 'entrypoints', 'name', 'triggers', 'version',
]);
const KNOWN_CAPABILITIES = new Set([
  'conversation.reply_draft', 'conversation.reply_send',
  'memory.read', 'memory.write',
  'research.web', 'research.file', 'files.read',
  'sandbox.propose', 'sandbox.execute',
]);
const CHANNELS = new Set(['local', 'voice', 'telegram']);

function exactKeys(value, expected, error) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...expected].sort())) {
    throw new TypeError(error);
  }
}

function string(value, name, max = 1_000) {
  if (typeof value !== 'string' || value.length < 1 || value.length > max) throw new TypeError(`skill_${name}_invalid`);
  return value;
}

function stringArray(value, name, { max = 50, itemMax = 300 } = {}) {
  if (!Array.isArray(value) || value.length > max || value.some((item) => typeof item !== 'string' || item.length < 1 || item.length > itemMax)) {
    throw new TypeError(`skill_${name}_invalid`);
  }
  if (new Set(value).size !== value.length) throw new TypeError(`skill_${name}_duplicate`);
  return value;
}

export function validateSkillRelativePath(value, kind = 'reference') {
  if (typeof value !== 'string' || value.length < 1 || value.length > 300
    || value.includes('\\') || value.startsWith('/') || /^[a-z]:/iu.test(value)
    || value.split('/').some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new TypeError(`skill_${kind}_path_invalid`);
  }
  return value;
}

function frontmatterOf(content) {
  const normalized = content.replaceAll('\r\n', '\n');
  if (!normalized.startsWith('---\n')) throw new Error('skill_frontmatter_missing');
  const end = normalized.indexOf('\n---\n', 4);
  if (end < 0) throw new Error('skill_frontmatter_missing');
  return { yaml: normalized.slice(4, end), body: normalized.slice(end + 5) };
}

export function parseSkillDocument(content) {
  if (typeof content !== 'string') throw new TypeError('skill_document_invalid');
  if (Buffer.byteLength(content, 'utf8') > MAX_SKILL_BYTES) throw new Error('skill_document_too_large');
  const { yaml, body } = frontmatterOf(content);
  if (/(?:^|\s)[&*][A-Za-z0-9_-]+/mu.test(yaml)) throw new Error('skill_yaml_alias_forbidden');
  const document = parseDocument(yaml, { strict: true, uniqueKeys: true, prettyErrors: false });
  if (document.errors.length) throw new Error(`skill_yaml_invalid:${document.errors[0].message}`);
  let metadata;
  try {
    metadata = document.toJS({ maxAliasCount: 0 });
  } catch (error) {
    throw new Error('skill_yaml_alias_forbidden', { cause: error });
  }
  exactKeys(metadata, REQUIRED_KEYS, 'skill_metadata_fields_invalid');
  if (!SLUG.test(metadata.name)) throw new TypeError('skill_name_invalid');
  string(metadata.description, 'description', 2_000);
  if (!SEMVER.test(metadata.version ?? '')) throw new TypeError('skill_version_invalid');
  const triggers = stringArray(metadata.triggers, 'triggers', { max: 30, itemMax: 200 });
  const capabilities = stringArray(metadata.capabilities, 'capabilities');
  for (const capability of capabilities) {
    if (!KNOWN_CAPABILITIES.has(capability)) throw new Error(`skill_capability_unknown:${capability}`);
  }
  const channels = stringArray(metadata.channels, 'channels', { max: 3, itemMax: 20 });
  for (const channel of channels) {
    if (!CHANNELS.has(channel)) throw new Error(`skill_channel_forbidden:${channel}`);
  }
  exactKeys(metadata.compatibility, ['mina', 'platforms'], 'skill_compatibility_invalid');
  string(metadata.compatibility.mina, 'compatibility', 50);
  const platforms = stringArray(metadata.compatibility.platforms, 'platforms', { max: 5, itemMax: 30 });
  if (platforms.some((platform) => !['win32', 'linux', 'darwin'].includes(platform))) throw new TypeError('skill_platform_invalid');
  exactKeys(metadata.entrypoints, ['instructions', 'references', 'scripts'], 'skill_entrypoints_invalid');
  if (metadata.entrypoints.instructions !== 'SKILL.md') throw new TypeError('skill_instructions_entrypoint_invalid');
  const references = stringArray(metadata.entrypoints.references, 'references').map((path) => validateSkillRelativePath(path, 'reference'));
  const scripts = stringArray(metadata.entrypoints.scripts, 'scripts').map((path) => validateSkillRelativePath(path, 'script'));
  exactKeys(metadata.budgets, ['maxCostMicros', 'maxDurationMs', 'maxTokens'], 'skill_budgets_invalid');
  for (const [key, value] of Object.entries(metadata.budgets)) {
    if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`skill_budget_invalid:${key}`);
  }
  if (!DIGEST.test(metadata.digest ?? '')) throw new TypeError('skill_digest_invalid');
  if (channels.includes('telegram') && (scripts.length > 0 || references.some((path) => !path.endsWith('.md'))
    || capabilities.some((capability) => !['research.web'].includes(capability)
      && !capability.startsWith('conversation.') && !capability.startsWith('memory.')))) {
    throw new Error('skill_telegram_scope_forbidden');
  }
  return Object.freeze({
    metadata: Object.freeze({
      name: metadata.name,
      description: metadata.description,
      version: metadata.version,
      triggers: Object.freeze(triggers.map((trigger) => trigger.normalize('NFKC'))),
      capabilities: Object.freeze([...capabilities]),
      channels: Object.freeze([...channels]),
      compatibility: Object.freeze({ mina: metadata.compatibility.mina, platforms: Object.freeze([...platforms]) }),
      entrypoints: Object.freeze({ instructions: 'SKILL.md', references: Object.freeze([...references]), scripts: Object.freeze([...scripts]) }),
      budgets: Object.freeze({ ...metadata.budgets }),
      digest: metadata.digest,
    }),
    body,
  });
}

export const SKILL_NAME_PATTERN = SLUG;
