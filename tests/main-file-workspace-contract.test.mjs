import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('main Mina Vision file workspace wiring', () => {
  it('initializes the Documents workspace and verifies named file missions', async () => {
    const source = await readFile(new URL('../src/ui/main.mjs', import.meta.url), 'utf8');

    expect(source).toContain("import { createMinaFileWorkspace } from '../files/mina-file-workspace.mjs';");
    expect(source).toContain('await minaFileWorkspace.ensure()');
    expect(source).toContain('minaFileWorkspace.prepareMission(mission)');
    expect(source).toContain('minaFileWorkspace.verifyMission(result, preparedMission)');
  });
});
