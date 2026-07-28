// @vitest-environment jsdom
// Rendu RÉEL du cercle de maturité dans le panneau Capacités (T0.2). Le VRAI index.html + le VRAI
// renderer.js s'exécutent dans jsdom ; seul le pont IPC est simulé. On ne vérifie pas une couleur
// CSS (jsdom ne fait pas de layout) mais le TEXTE que l'utilisateur lit : le libellé du cercle et,
// pour un domaine gelé, la mention « expérimental — non vérifié en usage réel ». C'est ce texte,
// pas un badge coloré, qui porte l'honnêteté de périmètre — il doit être présent, pas déduit.

import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it } from 'vitest';

const flush = async (rounds = 8) => {
  for (let index = 0; index < rounds; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

// Trois domaines, un par cercle : voice (cœur), code (maintenu), mail (gelé/expérimental).
const CAPABILITIES = [
  { id: 'voice', status: 'available' },
  { id: 'code', status: 'available' },
  { id: 'mail', status: 'unavailable', reason: 'non configuré' },
];

const RESULTS = {
  readProfiles: () => ({ profiles: [{ id: 'p1', name: 'Testeur', theme: 'system' }], activeProfileId: 'p1', welcomeCompleted: true }),
  capabilitiesList: () => CAPABILITIES,
  capabilityCatalog: () => ({ readiness: { missionReady: true }, health: [], capabilities: { tools: [] } }),
  memoryStatus: () => ({ locked: true, initialized: false }),
  probeMemory: () => ({ state: 'uninitialized' }),
  status: () => ({ ok: false }),
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
    get: (_target, prop) => (prop === 'width' || prop === 'height' ? 0 : magic),
    apply: () => magic,
    set: () => true,
  });
  window.HTMLCanvasElement.prototype.getContext = () => magic;
  window.requestAnimationFrame ??= (callback) => setTimeout(() => callback(0), 16);
  window.cancelAnimationFrame ??= (handle) => clearTimeout(handle);
  await import('../src/ui/renderer.js');
  await flush();
});

describe('panneau Capacités — cercle de maturité (T0.2)', () => {
  const rowFor = (id) => [...document.querySelectorAll('#capabilities-list li')]
    .find((li) => li.querySelector('strong')?.textContent === id) ?? null;

  it('chaque domaine rendu porte le libellé de son cercle', () => {
    expect(rowFor('voice')?.textContent, 'voice = cœur').toContain('Cœur');
    expect(rowFor('code')?.textContent, 'code = maintenu').toContain('Maintenu');
    expect(rowFor('mail')?.textContent, 'mail = expérimental').toContain('Expérimental');
  });

  it('un domaine gelé affiche explicitement « non vérifié en usage réel »', () => {
    const mail = rowFor('mail');
    expect(mail).not.toBeNull();
    expect(mail.textContent).toMatch(/non vérifié en usage réel/u);
  });

  it('un domaine cœur ou maintenu n’est PAS marqué expérimental', () => {
    expect(rowFor('voice').textContent).not.toMatch(/non vérifié en usage réel/u);
    expect(rowFor('code').textContent).not.toMatch(/non vérifié en usage réel/u);
  });

  it('l’état runtime reste affiché à côté du cercle (les deux axes coexistent)', () => {
    // Le cercle (maturité) ne remplace pas l'état (disponibilité) : mail est expérimental ET
    // indisponible avec sa raison, les deux visibles.
    const mail = rowFor('mail');
    expect(mail.textContent).toContain('indisponible');
    expect(mail.textContent).toContain('non configuré');
  });
});
