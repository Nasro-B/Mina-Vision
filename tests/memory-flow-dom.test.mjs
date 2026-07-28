// @vitest-environment jsdom
// Parcours MÉMOIRE réel (T2.3 — harnais jsdom généralisé). Le VRAI index.html + le VRAI renderer.js
// dans jsdom, seul le pont IPC est simulé. Le coffre chiffré est le domaine le plus critique ; ce
// test prouve que ses trois boutons (initialiser / verrouiller / déverrouiller) appellent bien l'IPC
// attendu et reflètent l'état — donc qu'un bouton « mort » (handler débranché) vire le test au rouge
// AVANT la prod, exactement le trou par lequel les bugs d'UI passaient.

import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it } from 'vitest';

const flush = async (rounds = 6) => {
  for (let index = 0; index < rounds; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

const calls = { initialize: 0, lock: 0, unlock: [] };

const RESULTS = {
  memoryStatus: () => ({ locked: true, initialized: false }),
  probeMemory: () => ({ state: 'uninitialized' }),
  readProfiles: () => ({ profiles: [{ id: 'p1', name: 'Nasro', theme: 'system' }], activeProfileId: 'p1', welcomeCompleted: true }),
  status: () => ({ ok: true, config: { credentialsRotated: true } }),
  initializeMemory: () => { calls.initialize += 1; return { locked: false, initialized: true, recoveryPhrase: 'alpha beta gamma delta epsilon zeta' }; },
  lockMemory: () => { calls.lock += 1; return { locked: true, initialized: true }; },
  unlockMemory: (input) => { calls.unlock.push(input); return { locked: false, initialized: true }; },
  readJournal: () => [],
};

const makeApi = () => new Proxy({}, {
  get: (_t, prop) => {
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
  window.cancelAnimationFrame ??= (h) => clearTimeout(h);
  await import('../src/ui/renderer.js');
  await flush();
});

const state = () => document.querySelector('#memory-state')?.textContent;

describe('parcours mémoire — coffre chiffré (T2.3)', () => {
  it('« Initialiser » appelle initializeMemory, déverrouille et montre la phrase une seule fois', async () => {
    document.querySelector('#memory-initialize').click();
    await flush();
    expect(calls.initialize, 'l\'IPC initializeMemory doit être appelé (sinon bouton mort)').toBe(1);
    expect(state()).toBe('Déverrouillée');
    const output = document.querySelector('#recovery-output');
    expect(output.hidden).toBe(false);
    expect(output.textContent).toContain('alpha beta gamma');
    expect(output.textContent).toMatch(/une seule fois/u);
  });

  it('« Verrouiller » appelle lockMemory et repasse l\'état à Verrouillée', async () => {
    document.querySelector('#memory-lock').click();
    await flush();
    expect(calls.lock).toBe(1);
    expect(state()).toBe('Verrouillée');
  });

  it('« Déverrouiller » transmet la phrase saisie à unlockMemory', async () => {
    document.querySelector('#recovery-phrase').value = 'alpha beta gamma delta epsilon zeta';
    document.querySelector('#memory-unlock').click();
    await flush();
    expect(calls.unlock).toHaveLength(1);
    expect(calls.unlock[0]).toEqual({ recoveryPhrase: 'alpha beta gamma delta epsilon zeta' });
    expect(state()).toBe('Déverrouillée');
    // La phrase est effacée du champ après usage (ne reste pas à l'écran).
    expect(document.querySelector('#recovery-phrase').value).toBe('');
  });
});
