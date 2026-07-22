import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';

const REQUIRED = Object.freeze(['python', 'javascript', 'powershell']);
const SHA = /^[a-f0-9]{64}$/u;
const VERSION = /^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$/u;

function safeRuntimePath(root, path, language) {
  if (typeof path !== 'string' || !path || path.includes('\\') || path.startsWith('/') || /^[a-z]:/iu.test(path)
    || path.split('/').some((segment) => !segment || segment === '.' || segment === '..')) return null;
  const target = resolve(join(root, ...path.split('/')));
  return target.startsWith(`${resolve(root)}${sep}`) ? target : null;
}

export function createRuntimeManifest({ manifestPath, runtimeRoot } = {}) {
  if (!manifestPath || !runtimeRoot) throw new TypeError('runtime_manifest_dependencies_required');
  let verified = null;

  async function verify() {
    let data;
    try {
      const bytes = await readFile(manifestPath);
      if (bytes.byteLength > 64 * 1024) return Object.freeze({ available: false, reason: 'runtime_manifest_too_large', runtimes: Object.freeze([]) });
      data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch {
      return Object.freeze({ available: false, reason: 'runtime_manifest_invalid', runtimes: Object.freeze([]) });
    }
    if (data?.schemaVersion !== 1 || !Array.isArray(data.runtimes)) {
      return Object.freeze({ available: false, reason: 'runtime_manifest_invalid', runtimes: Object.freeze([]) });
    }
    const languages = data.runtimes.map(({ language }) => language);
    if (data.runtimes.length !== REQUIRED.length || new Set(languages).size !== REQUIRED.length
      || REQUIRED.some((language) => !languages.includes(language))) {
      return Object.freeze({ available: false, reason: 'runtime_manifest_incomplete', runtimes: Object.freeze([]) });
    }
    const results = [];
    for (const language of REQUIRED) {
      const runtime = data.runtimes.find((entry) => entry.language === language);
      if (!VERSION.test(runtime.version ?? '') || !SHA.test(runtime.sha256 ?? '')
        || typeof runtime.sourceUrl !== 'string' || !runtime.sourceUrl.startsWith('https://')) {
        return Object.freeze({ available: false, reason: `runtime_manifest_entry_invalid:${language}`, runtimes: Object.freeze(results) });
      }
      const path = safeRuntimePath(runtimeRoot, runtime.path, language);
      if (!path) return Object.freeze({ available: false, reason: `runtime_path_invalid:${language}`, runtimes: Object.freeze(results) });
      let bytes;
      try {
        const stat = await lstat(path);
        if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('invalid');
        bytes = await readFile(path);
      } catch {
        return Object.freeze({ available: false, reason: `runtime_missing:${language}`, runtimes: Object.freeze(results) });
      }
      const actual = createHash('sha256').update(bytes).digest('hex');
      if (actual !== runtime.sha256) {
        return Object.freeze({ available: false, reason: `runtime_digest_mismatch:${language}`, runtimes: Object.freeze(results) });
      }
      results.push(Object.freeze({ language, version: runtime.version, path, sourceUrl: runtime.sourceUrl, verified: true }));
    }
    verified = new Map(results.map((runtime) => [runtime.language, runtime]));
    return Object.freeze({ available: true, reason: null, runtimes: Object.freeze(results) });
  }

  function resolveRuntime(language) {
    const runtime = verified?.get(language);
    if (!runtime) throw new Error(`runtime_unverified:${language}`);
    return runtime.path;
  }

  return Object.freeze({ verify, resolve: resolveRuntime });
}
