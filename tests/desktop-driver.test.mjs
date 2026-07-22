import { describe, expect, it, vi } from 'vitest';
import { createDesktopDriver } from '../src/executors/desktop-driver.mjs';

function createNutFake() {
  class Point {
    constructor(x, y) { this.x = x; this.y = y; }
  }

  return {
    Point,
    Button: { LEFT: 'left', RIGHT: 'right', MIDDLE: 'middle' },
    Key: {
      LeftControl: 'lc', RightControl: 'rc', LeftShift: 'ls', RightShift: 'rs',
      LeftAlt: 'la', RightAlt: 'ra', LeftSuper: 'lw', RightSuper: 'rw',
      A: 'a',
    },
    mouse: {
      setPosition: vi.fn(), click: vi.fn(), doubleClick: vi.fn(), rightClick: vi.fn(),
      scrollDown: vi.fn(), scrollUp: vi.fn(), scrollLeft: vi.fn(), scrollRight: vi.fn(),
      pressButton: vi.fn(), releaseButton: vi.fn(), drag: vi.fn(),
    },
    keyboard: { type: vi.fn(), pressKey: vi.fn(), releaseKey: vi.fn() },
    screen: {
      grab: vi.fn(async () => ({
        toRGB: async () => ({ width: 2, height: 1, data: Buffer.from([255, 0, 0, 255, 0, 255, 0, 255]) }),
      })),
    },
  };
}

describe('desktop driver', () => {
  it('accepts the observe ACTION as a no-op — same contract as the browser executor', async () => {
    // Regression: the model emits « observe » (look before acting); the browser handler table
    // tolerates it as a no-op but the desktop table threw « Action worker interdite: observe »,
    // killing every desktop mission at its first look-around. Executing it must touch nothing.
    const nut = createNutFake();
    const driver = createDesktopDriver(nut);

    await expect(driver.execute({ name: 'observe' })).resolves.toEqual({ executed: true });
    expect(nut.mouse.setPosition).not.toHaveBeenCalled();
    expect(nut.mouse.click).not.toHaveBeenCalled();
    expect(nut.keyboard.type).not.toHaveBeenCalled();
    expect(nut.keyboard.pressKey).not.toHaveBeenCalled();
    expect(nut.screen.grab).not.toHaveBeenCalled();
  });

  it('observes the screen as an in-memory PNG', async () => {
    const driver = createDesktopDriver(createNutFake());
    const observation = await driver.observe();

    expect(observation).toMatchObject({ mimeType: 'image/png', width: 2, height: 1 });
    expect(Buffer.from(observation.imageBase64, 'base64').subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  });

  it('executes allowlisted mouse, scroll, and text actions', async () => {
    const nut = createNutFake();
    const driver = createDesktopDriver(nut);

    await driver.execute({ name: 'click', x: 10, y: 20 });
    await driver.execute({ name: 'scroll', scrollY: -3, scrollX: 2 });
    await driver.execute({ name: 'type', text: 'bonjour' });

    expect(nut.mouse.setPosition).toHaveBeenCalledWith(expect.objectContaining({ x: 10, y: 20 }));
    expect(nut.mouse.click).toHaveBeenCalledWith('left');
    expect(nut.mouse.scrollUp).toHaveBeenCalledWith(3);
    expect(nut.mouse.scrollRight).toHaveBeenCalledWith(2);
    expect(nut.keyboard.type).toHaveBeenCalledWith('bonjour');
  });

  it('supports middle/triple clicks, held keys, and bounded waits', async () => {
    const nut = createNutFake();
    const sleep = vi.fn();
    const driver = createDesktopDriver(nut, { sleep });

    await driver.execute({ name: 'middle_click', x: 1, y: 2 });
    await driver.execute({ name: 'triple_click', x: 3, y: 4 });
    await driver.execute({ name: 'key_down', keys: ['A'] });
    await driver.execute({ name: 'key_up', keys: ['A'] });
    await driver.execute({ name: 'wait', milliseconds: 2_000 });

    expect(nut.mouse.click).toHaveBeenCalledWith('middle');
    expect(nut.mouse.doubleClick).toHaveBeenCalledWith('left');
    expect(nut.keyboard.pressKey).toHaveBeenCalledWith('a');
    expect(nut.keyboard.releaseKey).toHaveBeenCalledWith('a');
    expect(sleep).toHaveBeenCalledWith(2_000);
  });

  it('releases mouse buttons and modifier keys on emergency stop', async () => {
    const nut = createNutFake();
    const driver = createDesktopDriver(nut);

    await driver.releaseAllInputs();

    expect(nut.mouse.releaseButton).toHaveBeenCalledTimes(3);
    expect(nut.keyboard.releaseKey).toHaveBeenCalledWith('lc', 'rc', 'ls', 'rs', 'la', 'ra', 'lw', 'rw');
  });
});
