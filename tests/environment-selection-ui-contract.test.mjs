import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('renderer environment selection contract', () => {
  it('applies voice selection and keeps missing Gemini environment on the currently selected surface', async () => {
    const [renderer, main] = await Promise.all([
      readFile(new URL('../src/ui/renderer.js', import.meta.url), 'utf8'),
      readFile(new URL('../src/ui/main.mjs', import.meta.url), 'utf8'),
    ]);
    expect(main).toContain("name: 'selectionner_environnement'");
    expect(renderer).toContain("action?.type === 'select_environment'");
    expect(renderer).toContain("name === 'selectionner_environnement'");
    expect(renderer).toContain('applyEnvironmentSelection(environment');
    expect(renderer).toContain(': selectedEnvironment()');
  });
});
