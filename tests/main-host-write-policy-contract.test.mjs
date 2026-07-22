import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('main host write policy contract', () => {
  it('preflights desktop missions and guards user-selected host exports', async () => {
    const source = await readFile(new URL('../src/ui/main.mjs', import.meta.url), 'utf8');

    expect(source).toContain('createHostWritePolicy');
    expect(source).toContain('hostWritePolicy.requiresMissionConfirmation');
    expect(source).toContain('hostWritePolicy.authorize(filename)');
  });
});
