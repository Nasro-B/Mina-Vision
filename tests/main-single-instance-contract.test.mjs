import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('Mina Vision single instance contract', () => {
  it('prevents a second Electron process from opening the same databases and browser profile', async () => {
    const source = await readFile(new URL('../src/ui/main.mjs', import.meta.url), 'utf8');

    expect(source).toContain('app.requestSingleInstanceLock()');
    expect(source).toContain("app.on('second-instance'");
    expect(source).toContain('mainWindow.focus()');
  });
});
