import { lstat, readdir, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { readSkillMetadata } from './skill-loader.mjs';
import { SKILL_NAME_PATTERN } from './skill-schema.mjs';

export function createSkillRegistry({ root } = {}) {
  if (!root) throw new TypeError('skill_root_required');
  let entries = new Map();

  async function scan() {
    const rootReal = await realpath(resolve(root));
    const directoryEntries = await readdir(rootReal, { withFileTypes: true });
    const next = new Map();
    for (const entry of directoryEntries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isSymbolicLink()) throw new Error('skill_reparse_point_forbidden');
      if (!entry.isDirectory()) continue;
      if (!SKILL_NAME_PATTERN.test(entry.name)) throw new Error(`skill_slug_invalid:${entry.name}`);
      const directory = join(rootReal, entry.name);
      const stat = await lstat(directory);
      if (stat.isSymbolicLink()) throw new Error('skill_reparse_point_forbidden');
      const parsed = await readSkillMetadata(directory);
      if (parsed.metadata.digest === 'sha256:manifest-placeholder') throw new Error('skill_manifest_digest_missing');
      if (next.has(parsed.metadata.name)) throw new Error(`skill_duplicate:${parsed.metadata.name}`);
      next.set(parsed.metadata.name, Object.freeze({
        slug: entry.name,
        name: parsed.metadata.name,
        description: parsed.metadata.description,
        version: parsed.metadata.version,
        triggers: parsed.metadata.triggers,
        capabilities: parsed.metadata.capabilities,
        channels: parsed.metadata.channels,
        compatibility: parsed.metadata.compatibility,
        budgets: parsed.metadata.budgets,
        digest: parsed.metadata.digest,
      }));
    }
    entries = next;
    return Object.freeze([...entries.values()]);
  }

  function get(name) {
    return entries.get(name) ?? null;
  }

  return Object.freeze({ scan, get, list: () => Object.freeze([...entries.values()]) });
}
