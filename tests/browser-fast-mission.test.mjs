import { describe, expect, it, vi } from 'vitest';
import { createBrowserFastMission } from '../src/browser/browser-fast-mission.mjs';
import { routeBrowserCommand } from '../src/browser/browser-intent-router.mjs';

const okService = () => ({ execute: vi.fn(async (command) => ({ commandId: command.commandId, attempted: true, verified: true })) });

describe('browser-fast-mission (pré-filtre au point d’entrée mission)', () => {
  it('exige service + route', () => {
    expect(() => createBrowserFastMission({ service: {}, route: () => {} })).toThrow('dependencies_required');
  });

  it('« va sur youtube.com » → Fast Path (handled), la vision n’est jamais atteinte', async () => {
    const service = okService();
    const fast = createBrowserFastMission({ service, route: routeBrowserCommand });
    const out = await fast.tryHandle({ goal: 'va sur youtube.com', commandId: 'm1' });
    expect(out.handled).toBe(true);
    expect(service.execute).toHaveBeenCalledTimes(1);
    expect(out.result).toMatchObject({ verified: true });
  });

  it('« cherche recette » et « reviens en arrière » sont Fast Path', async () => {
    const fast = createBrowserFastMission({ service: okService(), route: routeBrowserCommand });
    expect((await fast.tryHandle({ goal: 'cherche recette crêpes', commandId: 'a' })).handled).toBe(true);
    expect((await fast.tryHandle({ goal: 'reviens en arrière', commandId: 'b' })).handled).toBe(true);
  });

  it('RETOMBE (handled:false) sur ce que l’exécuteur ne couvre pas : nouvel onglet, sémantique, ambigu, non-navigateur', async () => {
    const service = okService();
    const fast = createBrowserFastMission({ service, route: routeBrowserCommand });
    expect((await fast.tryHandle({ goal: 'ouvre un nouvel onglet', commandId: 'c' })).handled).toBe(false); // new_tab non couvert
    expect((await fast.tryHandle({ goal: 'clique sur Connexion', commandId: 'd' })).handled).toBe(false); // sémantique
    expect((await fast.tryHandle({ goal: 'fais le nécessaire', commandId: 'e' })).handled).toBe(false); // ambigu
    expect((await fast.tryHandle({ goal: 'raconte une blague', commandId: 'f' })).handled).toBe(false); // pas navigateur
    expect(service.execute).not.toHaveBeenCalled(); // aucun de ces cas n'atteint le Fast Path
  });
});
