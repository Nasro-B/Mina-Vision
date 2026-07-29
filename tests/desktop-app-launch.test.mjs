// « Mina peut utiliser n'importe quelle app du PC » — deux routes, testées de bout en bout :
//   1. Route native menu Démarrer : les alias clavier WIN/flèches manquaient (« Touche
//      interdite: WIN ») — toute mission « ouvre Paint et dessine » mourait là.
//   2. Action launch_app desktop : nom d'app validé anti-injection au normalizer, apps
//      sensibles bloquées par la politique, lancement réel injecté dans le driver.

import { describe, expect, it, vi } from 'vitest';
import { normalizeAction } from '../src/executors/action-normalizer.mjs';
import { classifyAction } from '../src/safety/policy.mjs';
import { createDesktopDriver } from '../src/executors/desktop-driver.mjs';

const VIEWPORT = { width: 1920, height: 1080 };

describe('normalizeAction — launch_app desktop', () => {
  it('accepte un nom d\'app Windows simple et le normalise', () => {
    const action = normalizeAction({ name: 'launch_app', arguments: { app: 'mspaint' } }, VIEWPORT);
    expect(action).toMatchObject({ name: 'launch_app', app: 'mspaint' });
  });

  it('accepte espaces, points, tirets (vrais noms d\'apps)', () => {
    for (const app of ['Adobe Photoshop 2026', 'notepad.exe', 'ms-paint', 'VLC media player']) {
      expect(normalizeAction({ name: 'launch_app', arguments: { app } }, VIEWPORT).app).toBe(app);
    }
  });

  it.each([
    'paint; del C:\\*',
    'paint && calc',
    "paint' -Verb RunAs",
    'C:\\Windows\\evil.exe',
    '..\\..\\malware',
    'paint|nc',
    'paint$(x)',
    'a',
  ])('rejette l\'injection ou le chemin « %s »', (app) => {
    expect(() => normalizeAction({ name: 'launch_app', arguments: { app } }, VIEWPORT))
      .toThrow(/Application invalide/u);
  });

  it('la route Android (package_name/activity_name) reste intacte', () => {
    const action = normalizeAction({
      name: 'launch_app',
      arguments: { package_name: 'com.spotify.music', activity_name: 'com.spotify.MainActivity' },
    }, VIEWPORT);
    expect(action.packageName).toBe('com.spotify.music');
    expect(action.app).toBeUndefined();
  });

  it('sans app NI composant Android → rejet', () => {
    expect(() => normalizeAction({ name: 'launch_app', arguments: {} }, VIEWPORT)).toThrow();
  });
});

describe('classifyAction — garde des apps sensibles au lancement', () => {
  it.each([
    'powershell', 'CMD.exe', 'Terminal', '1Password', 'KeePassXC', 'Windows Security',
    // Trous comblés (prouvés live) : pwsh = PowerShell 7 (shell moderne, distinct de « powershell ») ;
    // gestionnaires de mots de passe grand public absents de la liste d'origine ; regedit = système.
    'pwsh', 'pwsh.exe', 'LastPass', 'Dashlane', 'NordPass', 'Proton Pass', 'Enpass', 'RoboForm', 'regedit',
  ])(
    'bloque le lancement de « %s »',
    (app) => {
      const decision = classifyAction({ name: 'launch_app', app });
      expect(decision.decision).toBe('block');
    },
  );

  it('autorise les apps ordinaires SANS sur-bloquer (Proton Mail ≠ Proton Pass, compass ≠ enpass)', () => {
    // Garde anti-sur-blocage : les noms distinctifs ne doivent pas capturer une app légitime dont
    // le nom CONTIENT un fragment (« proton mail/vpn/drive » restent autorisés ; seul « pass » bloque).
    for (const app of ['mspaint', 'winword', 'chrome', 'notepad', 'Proton Mail', 'Proton VPN', 'compass']) {
      expect(classifyAction({ name: 'launch_app', app }).decision).toBe('allow');
    }
  });

  it('la protection existante en contexte (app au premier plan interdite) est inchangée', () => {
    expect(classifyAction({ name: 'click', x: 1, y: 1 }, { app: '1Password' }).decision).toBe('block');
  });
});

function createFakeNut() {
  const noop = async () => {};
  return {
    Point: class Point { constructor(x, y) { this.x = x; this.y = y; } },
    Button: { LEFT: 'L', MIDDLE: 'M', RIGHT: 'R' },
    Key: {
      LeftControl: 1, RightControl: 2, LeftShift: 3, RightShift: 4, LeftAlt: 5, RightAlt: 6,
      LeftSuper: 7, RightSuper: 8, Enter: 9, Escape: 10, Up: 11, Down: 12, Left: 13, Right: 14,
      PageUp: 15, PageDown: 16, Home: 17, End: 18, A: 19, Space: 20, Tab: 21,
    },
    mouse: { setPosition: noop, click: noop, doubleClick: noop, rightClick: noop, pressButton: noop, releaseButton: noop, scrollUp: noop, scrollDown: noop, scrollLeft: noop, scrollRight: noop },
    keyboard: { type: noop, pressKey: vi.fn(noop), releaseKey: vi.fn(noop) },
    screen: { grab: noop },
  };
}

describe('desktop-driver — alias clavier menu Démarrer et navigation', () => {
  it.each([
    ['WIN', 'LeftSuper'],
    ['WINDOWS', 'LeftSuper'],
    ['SUPER', 'LeftSuper'],
    ['META', 'LeftSuper'],
    ['CMD', 'LeftSuper'],
    ['UP', 'Up'],
    ['DOWN', 'Down'],
    ['LEFT', 'Left'],
    ['RIGHT', 'Right'],
    ['PAGEUP', 'PageUp'],
    ['PAGEDOWN', 'PageDown'],
    ['HOME', 'Home'],
    ['END', 'End'],
    ['Super_L', 'LeftSuper'],
    ['SUPER_R', 'RightSuper'],
    ['META_L', 'LeftSuper'],
    ['Win_R', 'RightSuper'],
  ])('la touche « %s » est acceptée (→ nut.Key.%s)', async (alias, enumName) => {
    const nut = createFakeNut();
    const driver = createDesktopDriver(nut, { sleep: async () => {} });
    await driver.execute({ name: 'key', keys: [alias] });
    expect(nut.keyboard.pressKey).toHaveBeenCalledWith(nut.Key[enumName]);
  });

  it('une touche réellement inconnue reste interdite', async () => {
    const driver = createDesktopDriver(createFakeNut(), { sleep: async () => {} });
    await expect(driver.execute({ name: 'key', keys: ['TOUCHE_FANTOME'] })).rejects.toThrow(/Touche interdite/u);
  });
});

describe('desktop-driver — launch_app', () => {
  it('délègue au lanceur injecté puis attend l\'ouverture de la fenêtre', async () => {
    const launched = [];
    const waits = [];
    const driver = createDesktopDriver(createFakeNut(), {
      sleep: async (ms) => waits.push(ms),
      launchApp: async (app) => launched.push(app),
    });
    const result = await driver.execute({ name: 'launch_app', app: 'mspaint' });
    expect(result).toEqual({ executed: true });
    expect(launched).toEqual(['mspaint']);
    expect(waits.some((ms) => ms >= 1_000)).toBe(true);
  });

  it('sans lanceur injecté (worker mobile) → erreur nominée, jamais de crash', async () => {
    const driver = createDesktopDriver(createFakeNut(), { sleep: async () => {} });
    await expect(driver.execute({ name: 'launch_app', app: 'mspaint' }))
      .rejects.toThrow(/lancement d'application indisponible/iu);
  });

  it('launch_app Android (packageName sans app) n\'est PAS routé vers le lanceur Windows', async () => {
    const launched = [];
    const driver = createDesktopDriver(createFakeNut(), {
      sleep: async () => {},
      launchApp: async (app) => launched.push(app),
    });
    await expect(driver.execute({ name: 'launch_app', packageName: 'com.x', activityName: 'Y' }))
      .rejects.toThrow();
    expect(launched).toEqual([]);
  });
});
