import { describe, expect, it, vi } from 'vitest';
import { createBrowserFastDriver } from '../src/browser/browser-fast-driver.mjs';
import { createBrowserNavigationService } from '../src/browser/browser-navigation-service.mjs';
import { routeBrowserCommand } from '../src/browser/browser-intent-router.mjs';

describe('browser-fast-driver (adaptateur executor → driver Fast Path)', () => {
  it('exige run + currentUrl', () => {
    expect(() => createBrowserFastDriver({ run: () => {} })).toThrow('dependencies_required');
  });

  it('navigate déclenche l’action navigate et renvoie l’URL courante comme resultUrl', async () => {
    const run = vi.fn(async () => {});
    const currentUrl = vi.fn(async () => 'https://youtube.com/');
    const driver = createBrowserFastDriver({ run, currentUrl });
    const receipt = await driver.navigate('https://youtube.com/');
    expect(run).toHaveBeenCalledWith({ name: 'navigate', url: 'https://youtube.com/' });
    expect(receipt).toMatchObject({ resultUrl: 'https://youtube.com/', readyState: 'complete' });
  });

  it('back/forward/reload passent par run ; closeTab n’expose pas d’URL', async () => {
    const run = vi.fn(async () => {});
    const driver = createBrowserFastDriver({ run, currentUrl: async () => 'https://x.fr/' });
    await driver.back(); await driver.reload(); await driver.closeTab();
    expect(run).toHaveBeenNthCalledWith(1, { name: 'go_back' });
    expect(run).toHaveBeenNthCalledWith(2, { name: 'reload' });
    expect(run).toHaveBeenNthCalledWith(3, { name: 'close_tab' });
    expect(await driver.closeTab()).toEqual({});
  });

  it('INTÉGRATION : routeur + Fast Path service + cet adaptateur → « va sur youtube.com » vérifié bout en bout', async () => {
    const pageUrl = { value: 'about:blank' };
    const run = vi.fn(async (action) => { if (action.name === 'navigate') pageUrl.value = action.url; });
    const driver = createBrowserFastDriver({ run, currentUrl: async () => pageUrl.value });
    const service = createBrowserNavigationService({ driver });
    const command = routeBrowserCommand('va sur youtube.com', { commandId: 'm1', source: 'mission', requestedAt: 1 });
    const res = await service.execute(command);
    expect(run).toHaveBeenCalledWith({ name: 'navigate', url: 'https://youtube.com/' });
    expect(res).toMatchObject({ attempted: true, verified: true, verificationReason: 'origine_confirmee' });
  });
});
