// @vitest-environment jsdom
// Parcours MISSION réel (T2.3 — harnais jsdom généralisé). Le VRAI index.html + le VRAI renderer.js
// dans jsdom, seul le pont IPC est simulé. La mission est le geste central de Mina ; ce test prouve
// que le bouton « Lancer » appelle bien `api.start` avec l'objectif saisi, que le garde « instruction
// vide » empêche un lancement à blanc, et que « Arrêter » appelle `api.stop`. Un bouton mort vire le
// test au rouge avant la prod.

import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it } from 'vitest';

const flush = async (rounds = 6) => {
  for (let index = 0; index < rounds; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

const calls = { start: [], stop: 0 };

const RESULTS = {
  memoryStatus: () => ({ locked: false, initialized: true }),
  status: () => ({ ok: true, config: { credentialsRotated: true } }),
  readProfiles: () => ({ profiles: [{ id: 'p1', name: 'Nasro', theme: 'system' }], activeProfileId: 'p1', welcomeCompleted: true }),
  start: (request) => { calls.start.push(request); return { status: 'completed', result: 'fait' }; },
  stop: () => { calls.stop += 1; return { stopped: true }; },
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

describe('parcours mission — le geste central (T2.3)', () => {
  it('« Lancer » sans instruction ne lance RIEN (garde à blanc)', async () => {
    document.querySelector('#goal').value = '   ';
    document.querySelector('#start-button').click();
    await flush();
    expect(calls.start, 'aucune mission lancée sans instruction').toHaveLength(0);
  });

  it('« Lancer » avec une instruction appelle api.start avec l\'objectif saisi', async () => {
    document.querySelector('#goal').value = 'va sur youtube';
    document.querySelector('#start-button').click();
    await flush();
    expect(calls.start, 'l\'IPC start doit être appelé (sinon bouton mort)').toHaveLength(1);
    expect(calls.start[0]).toMatchObject({ goal: 'va sur youtube' });
    expect(typeof calls.start[0].environment, 'un environnement est transmis').toBe('string');
    expect(calls.start[0]).toHaveProperty('memoryRequired');
  });

  it('« Arrêter » appelle api.stop', async () => {
    document.querySelector('#stop-button').click();
    await flush();
    expect(calls.stop).toBe(1);
  });
});
