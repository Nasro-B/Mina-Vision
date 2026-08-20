// @vitest-environment jsdom
// UX mémoire : quand le coffre existe déjà, "Initialiser" ne doit pas afficher un code brut.
// Le bouton doit guider vers le déverrouillage, sans lancer la réinitialisation de secours.

import { readFile } from 'node:fs/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const flush = async (rounds = 8) => {
  for (let index = 0; index < rounds; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

async function bootRenderer() {
  const calls = { initialize: 0, probe: 0, reinitialize: 0 };
  const RESULTS = {
    readProfiles: () => ({ profiles: [{ id: 'p1', name: 'Nasro', theme: 'system' }], activeProfileId: 'p1', welcomeCompleted: true }),
    status: () => ({ ok: true, config: { credentialsRotated: true } }),
    memoryStatus: () => ({ locked: true, initialized: true, semanticMode: 'ready', backupState: 'disabled' }),
    probeMemory: () => {
      calls.probe += 1;
      return { state: 'healthy' };
    },
    initializeMemory: () => {
      calls.initialize += 1;
      throw new Error('keyring_already_initialized');
    },
    reinitializeMemoryFresh: () => {
      calls.reinitialize += 1;
      return { ok: false, reason: 'refuse:healthy' };
    },
    readJournal: () => [],
  };
  const api = new Proxy({}, {
    get: (_target, prop) => {
      if (typeof prop !== 'string') return undefined;
      return (...args) => {
        const handler = RESULTS[prop];
        try { return Promise.resolve(handler ? handler(...args) : undefined); }
        catch (error) { return Promise.reject(error); }
      };
    },
  });

  const html = await readFile('src/ui/index.html', 'utf8');
  document.documentElement.innerHTML = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gu, '');
  window.mina = api;
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
  vi.resetModules();
  await import('../src/ui/renderer.js');
  await flush();
  return { calls };
}

describe('mémoire déjà initialisée — feedback utilisateur', () => {
  beforeEach(() => { document.documentElement.innerHTML = ''; });

  it('remplace keyring_already_initialized par une consigne de déverrouillage', async () => {
    const env = await bootRenderer();

    document.querySelector('#memory-initialize').click();
    await flush();

    expect(env.calls.initialize).toBe(1);
    expect(env.calls.probe).toBe(1);
    expect(env.calls.reinitialize).toBe(0);
    const logText = document.querySelector('#log').textContent;
    expect(logText).toContain('Mémoire déjà initialisée');
    expect(logText).toContain('Déverrouiller');
    expect(logText).not.toContain('keyring_already_initialized');
  });
});
