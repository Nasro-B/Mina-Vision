import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('start-mina PowerShell launcher', () => {
  it('stays ASCII-compatible because Windows PowerShell 5.1 reads BOM-less scripts with the legacy code page', async () => {
    const script = await readFile(new URL('../scripts/start-mina.ps1', import.meta.url), 'utf8');

    expect(script).toMatch(/^[\x00-\x7F]*$/u);
  });
});
