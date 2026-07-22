import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('main Computer Use routing contract', () => {
  it('uses the routed runtime and forwards the configured inference mode to every mission', async () => {
    const source = await readFile(new URL('../src/ui/main.mjs', import.meta.url), 'utf8');

    expect(source).toContain('createComputerUseRuntime');
    expect(source).not.toContain('const computerUse = createComputerUseClient');
    expect(source).toMatch(/mode:\s*activeRuntime\.config\.inference\.mode/u);
    expect(source).toMatch(/offline:\s*activeRuntime\.config\.inference\.offline/u);
  });
});
