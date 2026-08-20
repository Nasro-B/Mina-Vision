// @vitest-environment jsdom
// Parcours MAISON réel : le VRAI index.html + le VRAI renderer.js dans jsdom, seul le pont IPC
// est simulé. Ce test protège le bouton « Exécuter » contre la régression concrète où l'UI
// envoyait `{ deviceId, command }`, forme que le service Home ne sait pas exécuter.

import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it, vi } from 'vitest';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

const flush = async (rounds = 6) => {
  for (let index = 0; index < rounds; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

const calls = { executeHomeCommand: [] };

const RESULTS = {
  memoryStatus: () => ({ locked: false, initialized: true }),
  status: () => ({ ok: true, config: { credentialsRotated: true } }),
  readProfiles: () => ({ profiles: [{ id: 'p1', name: 'Nasro', theme: 'system' }], activeProfileId: 'p1', welcomeCompleted: true }),
  readJournal: () => [],
  listHomeDevices: () => ([{
    deviceId: 'light-bedroom',
    displayName: 'Plafonnier',
    aliases: [],
    roomName: 'Chambre',
    deviceClass: 'light',
    capabilities: ['read_state', 'turn_on', 'turn_off'],
    bindings: [{ connectorId: 'home-assistant', capabilities: ['read_state', 'turn_on', 'turn_off'] }],
    riskTier: 'low',
    confirmationPolicy: 'never',
    enabled: true,
  }]),
  homeConnectorHealth: () => ({ 'home-assistant': { available: true } }),
  executeHomeCommand: (request) => {
    calls.executeHomeCommand.push(request);
    return { commandId: request?.commandId, state: 'state_confirmed', verified: true };
  },
};

const makeApi = () => new Proxy({}, {
  get: (_target, prop) => {
    if (prop === 'onEvent') return () => {};
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
    get: (_target, prop) => (prop === 'width' || prop === 'height' ? 0 : magic), apply: () => magic, set: () => true,
  });
  window.HTMLCanvasElement.prototype.getContext = () => magic;
  window.requestAnimationFrame ??= (cb) => setTimeout(() => cb(0), 16);
  window.cancelAnimationFrame ??= (handle) => clearTimeout(handle);
  vi.resetModules();
  await import('../src/ui/renderer.js');
  await flush();
});

describe('parcours maison — commande locale structurée', () => {
  it('« Exécuter » transmet un intent Home expirant, pas un payload brut deviceId/command', async () => {
    document.querySelector('#home-target').value = 'Plafonnier';
    document.querySelector('#home-command').value = 'allumer';
    document.querySelector('#home-execute').click();
    await flush();

    expect(calls.executeHomeCommand).toHaveLength(1);
    expect(calls.executeHomeCommand[0]).toMatchObject({
      intent: {
        action: 'turn_on',
        targetText: 'Plafonnier',
        desiredState: { on: true },
        sourceChannel: 'local_ui',
        sessionId: 'home-ui',
      },
      confirmedLocally: false,
      offline: false,
    });
    expect(calls.executeHomeCommand[0].commandId).toMatch(UUID_V4);
    expect(calls.executeHomeCommand[0].expiresAt).toBeGreaterThan(Date.now());
    expect(calls.executeHomeCommand[0]).not.toHaveProperty('deviceId');
    expect(calls.executeHomeCommand[0]).not.toHaveProperty('command');
  });
});
