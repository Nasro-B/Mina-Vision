import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('sandbox main runtime contract', () => {
  it('uses a verified runtime manifest and no placeholder runner', async () => {
    const source = await readFile(new URL('../src/ui/main.mjs', import.meta.url), 'utf8');
    expect(source).toContain('createRuntimeManifest');
    expect(source).toContain('createWindowsSandboxLauncher');
    expect(source).not.toContain("runtimeManifest: { verify: async () => ({ available: false }) }");
    expect(source).not.toContain("throw new Error('sandbox_runner_not_configured')");
  });
});
