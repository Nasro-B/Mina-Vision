import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('constitution du canal mina_app', () => {
  it('définit le canal appairé sans élargir local_only', async () => {
    const constitution = await readFile(new URL('../../MINA.md', import.meta.url), 'utf8');
    expect(constitution).toContain('Application Mina (`mina_app`)');
    expect(constitution).toContain('Toute capacité `local_only` reste confirmable exclusivement sur le PC.');
  });
});
