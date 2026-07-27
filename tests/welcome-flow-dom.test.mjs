// @vitest-environment jsdom
// Reproduction FIDÈLE du flux « fenêtre de bienvenue » (bug réel signalé 2026-07-27 : le bouton
// « Continuer » ne marche pas / ne sauvegarde pas) : le VRAI index.html + le VRAI renderer.js
// s'exécutent dans jsdom, seul le pont IPC (window.mina) est simulé. Si un bouton du parcours
// n'appelle pas l'IPC attendu ou ne fait pas avancer l'étape, ce test échoue — avant la prod.

import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it } from 'vitest';

const flush = async (rounds = 6) => {
  for (let index = 0; index < rounds; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

const calls = { upsert: [], completeWelcome: 0, initialize: 0, setActive: [] };

// Chaque méthode absente du tableau renvoie une promesse résolue « undefined » : les chemins
// annexes du renderer (statut, mémoire, skills…) s'exécutent sans casser le chargement.
const RESULTS = {
  readProfiles: () => ({ profiles: [], activeProfileId: null, welcomeCompleted: false }),
  upsertProfile: (input) => {
    calls.upsert.push(input);
    return {
      id: 'profile-test-1',
      name: String(input?.name ?? '').trim() || 'Utilisateur',
      theme: input?.theme ?? 'system',
      language: input?.language ?? 'fr',
      tone: input?.tone ?? 'chaleureux',
      pronouns: input?.pronouns ?? '',
      preferences: input?.preferences ?? '',
    };
  },
  setActiveProfile: (id) => { calls.setActive.push(id); return { id, name: 'X', theme: 'system' }; },
  probeMemory: () => ({ state: 'uninitialized' }),
  initializeMemory: () => { calls.initialize += 1; return { recoveryPhrase: 'alpha beta gamma delta epsilon zeta' }; },
  completeWelcome: () => { calls.completeWelcome += 1; return true; },
  memoryStatus: () => ({ locked: true, initialized: false }),
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
  // Chemins relatifs au cwd vitest (racine du projet) : sous jsdom, import.meta.url est en http.
  const html = await readFile('src/ui/index.html', 'utf8');
  // Le HTML réel, sans exécuter ses <script src> (jsdom ne doit charger que ce qu'on lui donne).
  document.documentElement.innerHTML = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gu, '');
  window.mina = makeApi();
  window.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  Element.prototype.scrollIntoView ??= function scrollIntoView() {};
  // jsdom n'implémente ni canvas 2D ni requestAnimationFrame : l'orbe vocal (module verrouillé,
  // non modifié) exige un contexte au chargement. Objet « magique » : toute propriété renvoie
  // lui-même (appelable), width/height renvoient 0 — suffisant pour un rendu no-op.
  const magic = new Proxy(function magicNoop() {}, {
    get: (_target, prop) => (prop === 'width' || prop === 'height' ? 0 : magic),
    apply: () => magic,
    set: () => true,
  });
  window.HTMLCanvasElement.prototype.getContext = () => magic;
  window.requestAnimationFrame ??= (callback) => setTimeout(() => callback(0), 16);
  window.cancelAnimationFrame ??= (handle) => clearTimeout(handle);
  // Le VRAI renderer (module ES) — importé APRÈS la mise en place du DOM et du pont simulé.
  await import('../src/ui/renderer.js');
  await flush();
});

describe('fenêtre de bienvenue — parcours complet réel', () => {
  it("s'affiche au premier lancement (aucun profil)", () => {
    const overlay = document.querySelector('#welcome-overlay');
    expect(overlay).not.toBeNull();
    expect(overlay.hidden).toBe(false);
    expect(document.querySelector('.welcome-step[data-step="1"]').hidden).toBe(false);
  });

  it('« Créer mon profil » passe à l’étape 2', async () => {
    document.querySelector('#welcome-start').click();
    await flush();
    expect(document.querySelector('.welcome-step[data-step="1"]').hidden).toBe(true);
    expect(document.querySelector('.welcome-step[data-step="2"]').hidden).toBe(false);
  });

  it('« Continuer » SAUVEGARDE le profil (upsert appelé avec les champs saisis) et passe à l’étape 3', async () => {
    document.querySelector('#welcome-name').value = 'Testeur';
    document.querySelector('#welcome-pronouns').value = 'il';
    document.querySelector('#welcome-language').value = 'fr';
    document.querySelector('#welcome-tone').value = 'direct';
    document.querySelector('#welcome-theme-choice').value = 'dark';
    document.querySelector('#welcome-preferences').value = 'réponses courtes';

    document.querySelector('#welcome-save').click();
    await flush();

    expect(calls.upsert).toHaveLength(1);
    expect(calls.upsert[0]).toMatchObject({ name: 'Testeur', tone: 'direct', theme: 'dark', preferences: 'réponses courtes' });
    expect(document.querySelector('.welcome-step[data-step="2"]').hidden).toBe(true);
    expect(document.querySelector('.welcome-step[data-step="3"]').hidden).toBe(false);
    // Le thème choisi s'applique immédiatement.
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('« Initialiser la mémoire » affiche la phrase de récupération et le bouton d’entrée', async () => {
    document.querySelector('#welcome-mem-init').click();
    await flush();
    expect(calls.initialize).toBe(1);
    const phrase = document.querySelector('#welcome-phrase');
    expect(phrase.hidden).toBe(false);
    expect(phrase.textContent).toContain('alpha beta gamma');
    expect(document.querySelector('#welcome-finish-actions').hidden).toBe(false);
  });

  it('« J’ai noté ma phrase — Entrer dans Mina » termine l’accueil et ferme l’overlay', async () => {
    document.querySelector('#welcome-finish').click();
    await flush();
    expect(calls.completeWelcome).toBe(1);
    expect(document.querySelector('#welcome-overlay').hidden).toBe(true);
  });
});
