import { access } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const CANONICAL_CACHE = 'G:\\Programmes Installés\\caches\\NodeModules\\MinaVision\\native';

export function nativeCacheCandidates({ rootDir, env = process.env } = {}) {
  if (!rootDir) throw new TypeError('root_dir_required');
  return [...new Set([
    env.MINA_NATIVE_CACHE_DIR && path.resolve(env.MINA_NATIVE_CACHE_DIR),
    path.resolve(CANONICAL_CACHE),
    path.join(path.resolve(rootDir), 'node_modules', '.mina-native'),
  ].filter(Boolean))];
}

export async function resolveNativeCacheRoot({
  rootDir,
  env = process.env,
  exists = async (candidate) => {
    try {
      await access(candidate);
      return true;
    } catch {
      return false;
    }
  },
} = {}) {
  const candidates = nativeCacheCandidates({ rootDir, env });
  for (const candidate of candidates.slice(0, -1)) {
    if (await exists(candidate)) return candidate;
  }
  return candidates.at(-1);
}
