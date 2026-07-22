import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { parseSkillDocument, SKILL_NAME_PATTERN } from './skill-schema.mjs';

const MAX_FILES = 500;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;
const MAX_DOCUMENT_BYTES = 256 * 1024;
const PLACEHOLDER = 'digest: sha256:manifest-placeholder';

function safeSlug(slug) {
  if (typeof slug !== 'string' || !SKILL_NAME_PATTERN.test(slug)) throw new TypeError('skill_slug_invalid');
  return slug;
}

async function safeSkillDirectory(root, slug) {
  safeSlug(slug);
  const rootReal = await realpath(resolve(root));
  const candidate = join(rootReal, slug);
  const stat = await lstat(candidate);
  if (stat.isSymbolicLink()) throw new Error('skill_reparse_point_forbidden');
  if (!stat.isDirectory()) throw new Error('skill_directory_invalid');
  const candidateReal = await realpath(candidate);
  if (candidateReal !== rootReal && !candidateReal.startsWith(`${rootReal}${sep}`)) throw new Error('skill_root_escape');
  return candidateReal;
}

async function walk(directory, current = directory, output = []) {
  const entries = await readdir(current, { withFileTypes: true });
  for (const entry of entries) {
    const absolute = join(current, entry.name);
    const stat = await lstat(absolute);
    if (entry.isSymbolicLink() || stat.isSymbolicLink()) throw new Error('skill_reparse_point_forbidden');
    if (entry.isDirectory()) {
      await walk(directory, absolute, output);
    } else if (entry.isFile()) {
      const path = relative(directory, absolute).split(sep).join('/');
      if (isAbsolute(path) || path.split('/').includes('..')) throw new Error('skill_file_path_invalid');
      output.push({ absolute, path, size: stat.size });
      if (output.length > MAX_FILES) throw new Error('skill_file_count_exceeded');
      if (output.reduce((total, file) => total + file.size, 0) > MAX_TOTAL_BYTES) throw new Error('skill_total_size_exceeded');
    } else {
      throw new Error('skill_special_file_forbidden');
    }
  }
  return output;
}

function normalizedManifestBytes(path, bytes) {
  if (path !== 'SKILL.md') return bytes;
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const normalized = text.replace(/^digest:\s*sha256:(?:[a-f0-9]{64}|manifest-placeholder)\s*$/mu, PLACEHOLDER);
  if (normalized === text && !text.includes(PLACEHOLDER)) throw new Error('skill_digest_field_missing');
  return Buffer.from(normalized, 'utf8');
}

export async function computeSkillManifest({ directory } = {}) {
  if (!directory) throw new TypeError('skill_directory_required');
  const stat = await lstat(directory);
  if (stat.isSymbolicLink()) throw new Error('skill_reparse_point_forbidden');
  const files = (await walk(directory)).sort((a, b) => a.path.localeCompare(b.path));
  if (!files.some((file) => file.path === 'SKILL.md')) throw new Error('skill_document_missing');
  const hash = createHash('sha256');
  for (const file of files) {
    const bytes = await readFile(file.absolute);
    hash.update(file.path, 'utf8').update('\0').update(normalizedManifestBytes(file.path, bytes)).update('\0');
  }
  return Object.freeze({
    digest: `sha256:${hash.digest('hex')}`,
    files: Object.freeze(files.map(({ path, size }) => Object.freeze({ path, size }))),
  });
}

export async function readSkillMetadata(directory) {
  const filename = join(directory, 'SKILL.md');
  const stat = await lstat(filename);
  if (stat.isSymbolicLink()) throw new Error('skill_reparse_point_forbidden');
  if (!stat.isFile()) throw new Error('skill_document_missing');
  if (stat.size > MAX_DOCUMENT_BYTES) throw new Error('skill_document_too_large');
  const bytes = await readFile(filename);
  let content;
  try {
    content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    throw new Error('skill_document_invalid_utf8', { cause: error });
  }
  return parseSkillDocument(content);
}

export function createSkillLoader({ root } = {}) {
  if (!root) throw new TypeError('skill_root_required');
  async function load(slug) {
    const directory = await safeSkillDirectory(root, slug);
    const parsed = await readSkillMetadata(directory);
    if (parsed.metadata.digest === 'sha256:manifest-placeholder') throw new Error('skill_manifest_digest_missing');
    const manifest = await computeSkillManifest({ directory });
    if (manifest.digest !== parsed.metadata.digest) throw new Error('skill_manifest_digest_mismatch');
    const references = {};
    for (const path of parsed.metadata.entrypoints.references) {
      const descriptor = manifest.files.find((file) => file.path === path);
      if (!descriptor) throw new Error(`skill_reference_missing:${path}`);
      const bytes = await readFile(join(directory, ...path.split('/')));
      try {
        references[path] = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      } catch (error) {
        throw new Error(`skill_reference_invalid_utf8:${path}`, { cause: error });
      }
    }
    const scripts = parsed.metadata.entrypoints.scripts.map((path) => {
      const descriptor = manifest.files.find((file) => file.path === path);
      if (!descriptor) throw new Error(`skill_script_missing:${path}`);
      return Object.freeze({ path, size: descriptor.size });
    });
    return Object.freeze({
      slug,
      ...parsed.metadata,
      digest: manifest.digest,
      body: parsed.body,
      references: Object.freeze(references),
      scripts: Object.freeze(scripts),
    });
  }
  return Object.freeze({ load });
}
