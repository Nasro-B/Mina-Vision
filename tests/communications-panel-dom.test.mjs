// @vitest-environment jsdom
// Panneau COMMUNICATIONS réel (harnais jsdom généralisé) : le VRAI index.html + le VRAI renderer.js,
// seul le pont IPC est simulé. Prouve que la carte affiche l'état HONNÊTE du domaine (état + compteurs)
// et se rafraîchit au clic. Un panneau mort (jamais peuplé) vire le test au rouge.

import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it } from 'vitest';

const flush = async (rounds = 6) => {
  for (let index = 0; index < rounds; index += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

let commsState = { state: 'degraded', events: 0, pendingTasks: 2 };
const RESULTS = {
  communicationsStatus: () => commsState,
  memoryStatus: () => ({ locked: false, initialized: true }),
  status: () => ({ ok: true, config: { credentialsRotated: true } }),
  readProfiles: () => ({ profiles: [{ id: 'p1', name: 'Nasro', theme: 'system' }], activeProfileId: 'p1', welcomeCompleted: true }),
  readJournal: () => [],
};
const makeApi = () => new Proxy({}, {
  get: (_target, prop) => {
    if (typeof prop !== 'string') return undefined;
    return (...args) => {
      const handler = RESULTS[prop];
      try { return Promise.resolve(handler ? handler(...args) : undefined); }
      catch (error) { return Promise.reject(error); }
    };
  },
});

beforeAll(async () => {
  const html = await readFile('src/ui/index.html', 'utf8');
  document.documentElement.innerHTML = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gu, '');
  window.mina = makeApi();
  window.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  Element.prototype.scrollIntoView ??= function scrollIntoView() {};
  const magic = new Proxy(function magicNoop() {}, {
    get: (_t, prop) => (prop === 'width' || prop === 'height' ? 0 : magic), apply: () => magic, set: () => true,
  });
  window.HTMLCanvasElement.prototype.getContext = () => magic;
  window.requestAnimationFrame ??= (cb) => setTimeout(() => cb(0), 16);
  window.cancelAnimationFrame ??= (handle) => clearTimeout(handle);
  await import('../src/ui/renderer.js');
  await flush();
});

describe('panneau Communications (DOM réel)', () => {
  it('affiche l’état honnête du domaine (dégradé + compteurs) au chargement', () => {
    const card = document.querySelector('#communications-status');
    expect(card).not.toBeNull();
    expect(card.textContent).toMatch(/Dégradé/u);
    expect(card.textContent).toMatch(/2 tâche/u);
  });

  it('se rafraîchit au clic et reflète le nouvel état', async () => {
    commsState = { state: 'operational', events: 5, pendingTasks: 0 };
    document.querySelector('#communications-refresh').click();
    await flush();
    const card = document.querySelector('#communications-status');
    expect(card.textContent).toMatch(/Opérationnel/u);
    expect(card.textContent).toMatch(/5 événement/u);
  });

  it('n’expose aucune action déclenchable (observation seulement)', () => {
    // La carte ne contient que le bouton « Actualiser » (lecture) — aucun envoi/décrochage.
    const card = document.querySelector('[aria-labelledby="communications-title"]');
    const buttons = [...card.querySelectorAll('button')].map((b) => b.id);
    expect(buttons).toEqual(['communications-refresh']);
  });
});
