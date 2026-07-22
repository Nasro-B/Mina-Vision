import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { nativeCacheCandidates, resolveNativeCacheRoot } from '../scripts/native-cache-paths.mjs';

describe('native cache paths', () => {
  it('prefers the canonical Mina Vision cache under Programmes Installés', async () => {
    const canonical = path.resolve('G:\\Programmes Installés\\caches\\NodeModules\\MinaVision\\native');
    const selected = await resolveNativeCacheRoot({
      rootDir: 'C:\\Serveurs\\Mina Vision',
      exists: async (candidate) => candidate === canonical,
    });

    expect(selected).toBe(canonical);
    expect(nativeCacheCandidates({ rootDir: 'C:\\Serveurs\\Mina Vision' })[0]).toBe(canonical);
  });

  it('honours an explicit cache and never falls back to the retired G:\\NodeModules path', async () => {
    const explicit = path.resolve('D:\\MinaNative');
    expect(nativeCacheCandidates({
      rootDir: 'C:\\Serveurs\\Mina Vision',
      env: { MINA_NATIVE_CACHE_DIR: explicit },
    })).toEqual([
      explicit,
      path.resolve('G:\\Programmes Installés\\caches\\NodeModules\\MinaVision\\native'),
      path.resolve('C:\\Serveurs\\Mina Vision\\node_modules\\.mina-native'),
    ]);

    await expect(resolveNativeCacheRoot({
      rootDir: 'C:\\Serveurs\\Mina Vision',
      exists: async () => false,
    })).resolves.toBe(path.resolve('C:\\Serveurs\\Mina Vision\\node_modules\\.mina-native'));
  });
});
