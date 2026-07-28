// @vitest-environment jsdom
// Parcours CANAL TÉLÉPHONE (mina_app) au harnais jsdom réel (T2.3, dernier flux). Le VRAI index.html
// + le VRAI renderer.js, seul le pont IPC est simulé. Le canal chiffré téléphone↔PC se pilote par
// trois gestes — ouvrir l'appairage (code à usage unique), le fermer, révoquer un appareil. Ce test
// prouve qu'ils appellent le bon IPC et reflètent le résultat ; un bouton mort vire le test au rouge.

import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it } from 'vitest';

const flush = async (rounds = 6) => {
  for (let index = 0; index < rounds; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

const calls = { open: 0, close: 0, revoke: [] };

const RESULTS = {
  memoryStatus: () => ({ locked: false, initialized: true }),
  status: () => ({ ok: true, config: { credentialsRotated: true } }),
  readProfiles: () => ({ profiles: [{ id: 'p1', name: 'Nasro', theme: 'system' }], activeProfileId: 'p1', welcomeCompleted: true }),
  chatStatus: () => ({ listening: true, address: '127.0.0.1:8765', keyEpoch: 3, connectedDevices: [], devices: [] }),
  chatOpenPairing: () => { calls.open += 1; return { ok: true, code: '482913', expiresAtMs: 4102444800000 }; },
  chatClosePairing: () => { calls.close += 1; return { ok: true }; },
  chatRevokeDevice: (id) => { calls.revoke.push(id); return { ok: true, keyEpoch: 4 }; },
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

describe('canal téléphone mina_app — appairage & révocation (T2.3)', () => {
  it('« Ouvrir l\'appairage » appelle chatOpenPairing et affiche le code à usage unique', async () => {
    document.querySelector('#chat-pairing-open').click();
    await flush();
    expect(calls.open, 'l\'IPC chatOpenPairing doit être appelé (sinon bouton mort)').toBe(1);
    const code = document.querySelector('#chat-pairing-code').textContent;
    expect(code).toContain('482913');
    expect(code).toMatch(/une seule fois/u);
  });

  it('« Fermer l\'appairage » appelle chatClosePairing', async () => {
    document.querySelector('#chat-pairing-close').click();
    await flush();
    expect(calls.close).toBe(1);
    expect(document.querySelector('#chat-pairing-code').textContent).toMatch(/ferme/u);
  });

  it('cliquer « Révoquer » sur un appareil appelle chatRevokeDevice avec son id', async () => {
    // Le handler de révocation est délégué sur #chat-devices : on injecte un bouton comme le ferait
    // le rendu de la liste des appareils, puis on clique.
    const list = document.querySelector('#chat-devices');
    const button = document.createElement('button');
    button.dataset.action = 'chat-revoke';
    button.dataset.value = 'device-42';
    list.append(button);
    button.click();
    await flush();
    expect(calls.revoke).toEqual(['device-42']);
  });
});
