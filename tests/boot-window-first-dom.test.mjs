// @vitest-environment jsdom
// Comportement FENÊTRE D'ABORD (T1.1) prouvé de façon déterministe : le VRAI index.html + le VRAI
// renderer.js dans jsdom, avec un pont IPC qui REJETTE au premier paint (handlers pas encore prêts,
// comme quand la fenêtre s'ouvre avant l'init des domaines) puis RÉSOUT après `mina:boot:ready`.
//
// Ce test verrouille le constat du 2026-07-28 : si `welcome.boot()` affichait la bienvenue sur rejet
// de `readProfiles`, un utilisateur EXISTANT verrait un overlay fantôme au démarrage. Ici on prouve
// qu'il n'apparaît pas au premier paint, et que la décision d'accueil devient correcte à boot_ready.

import { readFile } from 'node:fs/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const flush = async (rounds = 8) => {
  for (let index = 0; index < rounds; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

// Fabrique un environnement renderer neuf par test. Modèle FIDÈLE de la fenêtre-d'abord : tant que
// l'init des domaines n'est pas finie (`ready` faux), TOUT appel IPC rejette (aucun handler
// enregistré) — pas seulement le premier. `mina:boot:ready` bascule `ready` à vrai, et les appels
// suivants résolvent l'état réel des profils.
async function bootRenderer({ profilesWhenReady }) {
  const state = { ready: false, readProfiles: 0 };
  let eventHandler = null;
  const RESULTS = {
    readProfiles: () => {
      state.readProfiles += 1;
      if (!state.ready) throw new Error('ipc_not_ready');
      return profilesWhenReady;
    },
    upsertProfile: (input) => ({ id: 'p1', name: input?.name ?? 'X', theme: 'system', language: 'fr', tone: 'chaleureux' }),
    setActiveProfile: (id) => ({ id, name: 'X', theme: 'system' }),
    probeMemory: () => ({ state: 'ready' }),
    memoryStatus: () => ({ locked: true, initialized: true }),
    // Comme le vrai handler `mina:status` : absent tant que l'init n'a pas enregistré les IPC ; une
    // fois prêt, renvoie un état sain (clés renouvelées → applyStatusFromHealth cache le panneau).
    status: () => {
      if (!state.ready) throw new Error("No handler registered for 'mina:status'");
      return { ok: true, config: { credentialsRotated: true, dryRun: true } };
    },
    readJournal: () => [],
  };
  const api = new Proxy({}, {
    get: (_t, prop) => {
      if (prop === 'onEvent') return (cb) => { eventHandler = cb; };
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
    get: (_t, prop) => (prop === 'width' || prop === 'height' ? 0 : magic), apply: () => magic, set: () => true,
  });
  window.HTMLCanvasElement.prototype.getContext = () => magic;
  window.requestAnimationFrame ??= (cb) => setTimeout(() => cb(0), 16);
  window.cancelAnimationFrame ??= (h) => clearTimeout(h);
  // Chaque test doit RÉEXÉCUTER le module renderer (ses effets de bord de bootstrap tournent une
  // fois à l'import). `resetModules` vide le cache ESM de vitest pour que l'import ré-évalue tout.
  vi.resetModules();
  await import('../src/ui/renderer.js');
  await flush();
  return {
    fireBootReady: () => { state.ready = true; eventHandler?.({ type: 'boot_ready' }); },
    get readProfilesCount() { return state.readProfiles; },
  };
}

const overlayVisible = () => {
  const overlay = document.querySelector('#welcome-overlay');
  return Boolean(overlay) && overlay.hidden === false;
};

describe('fenêtre-d\'abord — bienvenue non fantôme (T1.1)', () => {
  beforeEach(() => { document.documentElement.innerHTML = ''; });

  it('profil EXISTANT : pas d\'overlay au 1er paint (IPC pas prêt) NI après boot_ready', async () => {
    const existing = { profiles: [{ id: 'p1', name: 'Nasro', theme: 'system' }], activeProfileId: 'p1', welcomeCompleted: true };
    const env = await bootRenderer({ profilesWhenReady: existing });
    // Premier paint : tous les readProfiles ont rejeté → welcome.boot() est sorti sans rien montrer.
    expect(overlayVisible(), 'overlay ne doit PAS apparaître au premier paint').toBe(false);
    const countAtPaint = env.readProfilesCount;
    env.fireBootReady();
    await flush();
    // boot_ready : readProfiles résout (profil complet) → toujours pas d'accueil. Aucun fantôme.
    expect(overlayVisible(), 'utilisateur existant : jamais d\'accueil').toBe(false);
    expect(env.readProfilesCount, 'bootstrap rejoué à boot_ready').toBeGreaterThan(countAtPaint);
  });

  it('AUCUN profil : pas d\'overlay au 1er paint ; overlay affiché après boot_ready', async () => {
    const empty = { profiles: [], activeProfileId: null, welcomeCompleted: false };
    const env = await bootRenderer({ profilesWhenReady: empty });
    expect(overlayVisible(), 'pas d\'overlay tant que l\'IPC n\'a pas répondu').toBe(false);
    env.fireBootReady();
    await flush();
    // boot_ready : readProfiles résout (aucun profil) → l'accueil s'affiche, cette fois à raison.
    expect(overlayVisible(), 'premier lancement réel : accueil affiché après boot_ready').toBe(true);
  });

  it('« Accès IA verrouillé » ne s\'affiche PAS quand mina:status rejette au 1er paint (régression T1.1)', async () => {
    // Reproduction exacte du bug signalé : `mina:status` n'est pas encore enregistré au premier
    // paint (fenêtre-d'abord) → l'ancien code affichait le panneau de verrouillage avec « No handler
    // registered for mina:status ». Le panneau doit rester caché tant que boot_ready n'a pas eu lieu.
    const env = await bootRenderer({ profilesWhenReady: { profiles: [], activeProfileId: null, welcomeCompleted: false } });
    const lockPanel = document.querySelector('#lock-panel');
    expect(lockPanel, '#lock-panel présent').not.toBeNull();
    expect(lockPanel.hidden, 'pas de verrouillage tant que le boot n\'est pas prêt').toBe(true);
    env.fireBootReady();
    await flush();
    // boot_ready : status résout ok → toujours pas de verrouillage.
    expect(lockPanel.hidden, 'statut OK après boot_ready : pas de verrouillage').toBe(true);
  });
});
