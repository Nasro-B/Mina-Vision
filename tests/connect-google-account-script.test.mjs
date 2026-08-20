import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('connect-google-account script', () => {
  it('uses the same named Mina Vision userData as the main app before reading the keyring', async () => {
    const source = await readFile('scripts/connect-google-account.mjs', 'utf8');
    const strategyIndex = source.indexOf('resolveUserDataStrategy({');
    const setPathIndex = source.indexOf("app.setPath('userData', namedUserData)");
    const readyIndex = source.indexOf('await app.whenReady()');

    expect(source).toContain("import { resolveUserDataStrategy } from '../src/ui/user-data-path.mjs';");
    expect(source).toContain("app.setName('Mina Vision')");
    expect(source).toContain('Projet Google Cloud détecté');
    expect(strategyIndex).toBeGreaterThanOrEqual(0);
    expect(setPathIndex).toBeGreaterThan(strategyIndex);
    expect(readyIndex).toBeGreaterThan(setPathIndex);
  });

  it('explains Google testing-mode access_denied instead of leaving a vague timeout', async () => {
    const source = await readFile('scripts/connect-google-account.mjs', 'utf8');
    expect(source).toContain('function printDeniedHelp(reason)');
    expect(source).toContain('access_denied');
    expect(source).toContain('utilisateur de test OAuth');
  });

  it('explains Google disallowed_useragent / insecure browser instead of retrying the controlled browser', async () => {
    const source = await readFile('scripts/connect-google-account.mjs', 'utf8');
    expect(source).toContain('disallowed_useragent');
    expect(source).toContain('navigateur Chrome normal non piloté');
    expect(source).toContain('pas via l’extension Chrome');
  });
});
