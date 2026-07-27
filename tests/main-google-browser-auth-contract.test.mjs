import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('main Google browser authentication wiring', () => {
  it('closes automation before launching normal Chrome and recreates closed contexts', async () => {
    const source = await readFile(new URL('../src/ui/main.mjs', import.meta.url), 'utf8');
    const renderer = await readFile(new URL('../src/ui/renderer.js', import.meta.url), 'utf8');

    expect(source).toContain("import { createBrowserProfileAuthenticator } from '../executors/browser-profile-auth.mjs';");
    expect(source).toContain("ipcMain.handle('mina:browser:google-login'");
    // Depuis 2026-07-25, la détection couvre AUSSI la page fermée à la main (contexte vivant,
    // page morte → missions en boucle « browser has been closed ») : executorDead + relance.
    expect(source).toContain('executorDead(browserExecutor)');
    expect(source).toContain("executor.getPage?.()?.isClosed?.()");
    expect(source).toContain("name: 'connecter_gmail_navigateur'");
    expect(renderer).toContain('api.connectGoogleBrowser()');
  });
});
