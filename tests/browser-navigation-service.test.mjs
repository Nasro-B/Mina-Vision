import { describe, expect, it, vi } from 'vitest';
import { createBrowserNavigationService } from '../src/browser/browser-navigation-service.mjs';
import { routeBrowserCommand } from '../src/browser/browser-intent-router.mjs';

function fakeDriver(over = {}) {
  return {
    navigate: vi.fn(async (url) => ({ pageId: 'p1', navigationId: 'n1', resultUrl: url, readyState: 'complete' })),
    newTab: vi.fn(async (url) => ({ pageId: 'p2', navigationId: 'n2', resultUrl: url ?? 'about:blank' })),
    closeTab: vi.fn(async () => ({})),
    back: vi.fn(async () => ({})),
    forward: vi.fn(async () => ({})),
    reload: vi.fn(async () => ({})),
    open: vi.fn(async () => ({ pageId: 'p0' })),
    ...over,
  };
}

const cmd = (utterance) => routeBrowserCommand(utterance, { commandId: 'c1', source: 'voice', requestedAt: 1 });

describe('browser-navigation-service (Fast Path — le correctif de lenteur)', () => {
  it('exige un driver complet', () => {
    expect(() => createBrowserNavigationService({ driver: { navigate() {} } })).toThrow('driver_required');
  });

  it('« va sur youtube.com » → navigate direct + vérifié par origine (aucune vision)', async () => {
    const driver = fakeDriver();
    const svc = createBrowserNavigationService({ driver });
    const command = cmd('va sur youtube.com');
    expect(svc.canHandle(command)).toBe(true);
    const res = await svc.execute(command);
    expect(driver.navigate).toHaveBeenCalledWith('https://youtube.com/');
    expect(res).toMatchObject({ attempted: true, verified: true, verificationReason: 'origine_confirmee', route: 'fast' });
  });

  it('« cherche recette crêpes » → navigate vers l’URL Google (Fast Path, pas de saisie DOM)', async () => {
    const driver = fakeDriver();
    const svc = createBrowserNavigationService({ driver });
    const res = await svc.execute(cmd('cherche recette crêpes'));
    expect(driver.navigate).toHaveBeenCalledWith(expect.stringContaining('google.com/search?q='));
    expect(res.verified).toBe(true);
  });

  it('HONNÊTETÉ : origine d’arrivée ≠ cible → attempted mais NON vérifié (jamais de faux succès)', async () => {
    const driver = fakeDriver({ navigate: vi.fn(async () => ({ pageId: 'p1', resultUrl: 'https://ailleurs.example/', readyState: 'complete' })) });
    const svc = createBrowserNavigationService({ driver });
    const res = await svc.execute(cmd('va sur youtube.com'));
    expect(res).toMatchObject({ attempted: true, verified: false, errorCode: 'navigation_non_confirmee' });
  });

  it('historique (« reviens en arrière ») → back appelé, vérifié sans URL', async () => {
    const driver = fakeDriver();
    const svc = createBrowserNavigationService({ driver });
    const res = await svc.execute(cmd('reviens en arrière'));
    expect(driver.back).toHaveBeenCalled();
    expect(res).toMatchObject({ verified: true, verificationReason: 'back_effectue' });
  });

  it('driver qui échoue → attempted:true, verified:false, errorCode (jamais un throw non géré)', async () => {
    const driver = fakeDriver({ navigate: vi.fn(async () => { throw new Error('net_down'); }) });
    const svc = createBrowserNavigationService({ driver });
    const res = await svc.execute(cmd('va sur youtube.com'));
    expect(res).toMatchObject({ attempted: true, verified: false, errorCode: 'net_down' });
  });

  it('refuse une commande non-fast (elle relève du sémantique/vision)', async () => {
    const svc = createBrowserNavigationService({ driver: fakeDriver() });
    const semantic = cmd('clique sur le bouton connexion');
    expect(svc.canHandle(semantic)).toBe(false);
    await expect(svc.execute(semantic)).rejects.toThrow('not_fast');
  });
});
