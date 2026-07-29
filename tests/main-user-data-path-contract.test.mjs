import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('main user-data path contract', () => {
  it('resolves explicit profiles before the legacy migration and preserves them', async () => {
    const source = await readFile(new URL('../src/ui/main.mjs', import.meta.url), 'utf8');
    const resolverCall = source.indexOf('resolveUserDataStrategy({');
    const migration = source.indexOf("const legacyUserData = path.join(app.getPath('appData'), 'Electron');");

    expect(source).toContain("import { resolveUserDataStrategy } from './user-data-path.mjs';");
    expect(resolverCall).toBeGreaterThan(-1);
    expect(migration).toBeGreaterThan(resolverCall);
    expect(source).toContain('if (!preserveExplicitUserData) {');
    expect(source).toContain("app.setPath('userData', namedUserData);");
  });
});
