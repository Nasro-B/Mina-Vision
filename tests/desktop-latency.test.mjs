// Latence des missions bureau — deux causes MESURÉES le 2026-07-22 (écran réel 1920×1080) :
//   1. nut-js d'usine : keyboard.autoDelayMs=300 (« Mina Vision » tapé = 3,3 s !) et
//      mouse.autoDelayMs=100 — jamais configurés. Le driver doit les régler à 15/25 ms.
//   2. Observation PNG plein format : 367 ms de conversion + 351 Ko envoyés au modèle À CHAQUE
//      action. Le worker injecte un encodeur JPEG 1280 (65 Ko) ; le driver doit préserver les
//      dimensions RÉELLES de l'écran (le mapping souris 0-1000 → pixels en dépend).

import { describe, expect, it } from 'vitest';
import { createDesktopDriver } from '../src/executors/desktop-driver.mjs';

function createFakeNut() {
  const noop = async () => {};
  return {
    keyboard: { config: { autoDelayMs: 300 }, type: noop, pressKey: noop, releaseKey: noop },
    mouse: { config: { autoDelayMs: 100, mouseSpeed: 1000 }, setPosition: noop, click: noop, doubleClick: noop, rightClick: noop, pressButton: noop, releaseButton: noop, scrollUp: noop, scrollDown: noop, scrollLeft: noop, scrollRight: noop },
    screen: {
      grab: async () => ({
        toRGB: async () => ({ width: 1_920, height: 1_080, data: Buffer.alloc(16) }),
      }),
    },
    Point: class Point { constructor(x, y) { this.x = x; this.y = y; } },
    Button: { LEFT: 'L', MIDDLE: 'M', RIGHT: 'R' },
    Key: { LeftControl: 1, RightControl: 2, LeftShift: 3, RightShift: 4, LeftAlt: 5, RightAlt: 6, LeftSuper: 7, RightSuper: 8 },
  };
}

describe('desktop-driver — réglages anti-latence nut-js', () => {
  it('écrase les délais d\'usine : clavier 300→15 ms, souris 100→25 ms', () => {
    const nut = createFakeNut();
    createDesktopDriver(nut, { sleep: async () => {} });
    expect(nut.keyboard.config.autoDelayMs).toBe(15);
    expect(nut.mouse.config.autoDelayMs).toBe(25);
  });

  it('tolère un nut sans objets config (fakes de tests, versions futures)', () => {
    const nut = createFakeNut();
    delete nut.keyboard.config;
    delete nut.mouse.config;
    expect(() => createDesktopDriver(nut, { sleep: async () => {} })).not.toThrow();
  });
});

describe('desktop-driver — observation encodée injectable', () => {
  it('passe le brut RGBA à l\'encodeur et PRÉSERVE les dimensions réelles de l\'écran', async () => {
    const nut = createFakeNut();
    const received = [];
    const driver = createDesktopDriver(nut, {
      sleep: async () => {},
      encodeObservation: async ({ width, height, data }) => {
        received.push({ width, height, bytes: data.length });
        return { imageBase64: 'JPEG_REDUIT', mimeType: 'image/jpeg' };
      },
    });
    const observation = await driver.observe();
    expect(received[0]).toEqual({ width: 1_920, height: 1_080, bytes: 16 });
    // L'image peut être réduite, les dimensions rapportées restent celles de l'ÉCRAN :
    expect(observation).toEqual({
      imageBase64: 'JPEG_REDUIT',
      mimeType: 'image/jpeg',
      width: 1_920,
      height: 1_080,
    });
  });

  it('sans encodeur injecté : PNG plein format (comportement historique intact)', async () => {
    const nut = createFakeNut();
    nut.screen.grab = async () => ({
      toRGB: async () => ({ width: 2, height: 1, data: Buffer.from([255, 0, 0, 255, 0, 255, 0, 255]) }),
    });
    const driver = createDesktopDriver(nut, { sleep: async () => {} });
    const observation = await driver.observe();
    expect(observation.mimeType).toBe('image/png');
    expect(Buffer.from(observation.imageBase64, 'base64').subarray(1, 4).toString()).toBe('PNG');
    expect(observation.width).toBe(2);
  });
});
