import { describe, expect, it, vi } from 'vitest';
import { createDesktopCursorOverlay } from '../src/ui/desktop-cursor-overlay.mjs';

function setup() {
  const windows = [];
  class BrowserWindow {
    constructor(options) {
      this.options = options;
      this.webContents = { executeJavaScript: vi.fn(async () => true) };
      this.loadFile = vi.fn(async () => {});
      this.setIgnoreMouseEvents = vi.fn();
      this.setAlwaysOnTop = vi.fn();
      this.showInactive = vi.fn();
      this.hide = vi.fn();
      this.close = vi.fn();
      this.isDestroyed = vi.fn(() => false);
      windows.push(this);
    }
  }
  const screen = {
    getAllDisplays: () => [
      { bounds: { x: -1_280, y: 0, width: 1_280, height: 1_024 } },
      { bounds: { x: 0, y: 0, width: 1_920, height: 1_080 } },
    ],
  };
  return { overlay: createDesktopCursorOverlay({ BrowserWindow, screen }), windows };
}

describe('desktop virtual cursor overlay', () => {
  it('creates a click-through transparent overlay spanning all displays', async () => {
    const { overlay, windows } = setup();

    await overlay.previewAction({ name: 'click', x: 100, y: 200 }, { safety: { decision: 'confirm' } });

    const window = windows[0];
    expect(window.options).toMatchObject({
      x: -1_280, y: 0, width: 3_200, height: 1_080,
      transparent: true, frame: false, focusable: false, skipTaskbar: true,
    });
    expect(window.setIgnoreMouseEvents).toHaveBeenCalledWith(true, { forward: true });
    expect(window.webContents.executeJavaScript).toHaveBeenCalledWith(expect.stringContaining('"x":1380'));
    expect(window.showInactive).toHaveBeenCalled();
  });

  it('hides and closes without taking focus', async () => {
    const { overlay, windows } = setup();
    await overlay.previewAction({ name: 'type' }, {});
    await overlay.hide();
    overlay.close();

    expect(windows[0].hide).toHaveBeenCalled();
    expect(windows[0].close).toHaveBeenCalled();
  });
});
