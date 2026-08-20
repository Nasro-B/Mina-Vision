import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('rebuild-native script contract', () => {
  it('rebuilds the Node better-sqlite3 binding before caching it', async () => {
    const source = await readFile('scripts/rebuild-native.mjs', 'utf8');
    const rebuildIndex = source.indexOf('await runNpmRebuild();');
    const cacheIndex = source.indexOf('await copyFile(BINDING_PATH, nodeBinding);');

    expect(rebuildIndex).toBeGreaterThanOrEqual(0);
    expect(cacheIndex).toBeGreaterThan(rebuildIndex);
  });
});
