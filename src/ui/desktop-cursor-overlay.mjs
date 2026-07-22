import path from 'node:path';
import { fileURLToPath } from 'node:url';

const UI_DIR = path.dirname(fileURLToPath(import.meta.url));

function displayUnion(displays) {
  if (!Array.isArray(displays) || displays.length === 0) throw new Error('cursor_display_unavailable');
  const left = Math.min(...displays.map(({ bounds }) => bounds.x));
  const top = Math.min(...displays.map(({ bounds }) => bounds.y));
  const right = Math.max(...displays.map(({ bounds }) => bounds.x + bounds.width));
  const bottom = Math.max(...displays.map(({ bounds }) => bounds.y + bounds.height));
  return Object.freeze({ x: left, y: top, width: right - left, height: bottom - top });
}

export function createDesktopCursorOverlay({ BrowserWindow, screen } = {}) {
  if (typeof BrowserWindow !== 'function' || !screen?.getAllDisplays) {
    throw new TypeError('cursor_overlay_dependencies_required');
  }
  let window = null;
  let bounds = null;
  let ready = null;
  let last = { x: 24, y: 24 };

  async function ensureWindow() {
    if (window && !window.isDestroyed()) return window;
    bounds = displayUnion(screen.getAllDisplays());
    window = new BrowserWindow({
      ...bounds,
      transparent: true,
      frame: false,
      focusable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false,
      show: false,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    window.setIgnoreMouseEvents(true, { forward: true });
    window.setAlwaysOnTop('screen-saver');
    ready = window.loadFile(path.join(UI_DIR, 'desktop-cursor-overlay.html'));
    await ready;
    return window;
  }

  async function previewAction(action = {}, { safety = {} } = {}) {
    const active = await ensureWindow();
    if (Number.isFinite(action.x) && Number.isFinite(action.y)) {
      last = { x: action.x - bounds.x, y: action.y - bounds.y };
    }
    const payload = Object.freeze({
      x: Math.min(Math.max(last.x, 0), bounds.width - 1),
      y: Math.min(Math.max(last.y, 0), bounds.height - 1),
      name: String(action.name ?? 'action').replace(/[^a-z0-9_. -]/giu, '').slice(0, 40),
      decision: ['allow', 'confirm', 'block'].includes(safety.decision) ? safety.decision : 'allow',
    });
    await active.webContents.executeJavaScript(`globalThis.renderMinaCursor(${JSON.stringify(payload)})`);
    active.showInactive();
    return Object.freeze({ visible: true });
  }

  async function hide() {
    if (window && !window.isDestroyed()) window.hide();
    return Object.freeze({ visible: false });
  }

  function close() {
    if (window && !window.isDestroyed()) window.close();
    window = null;
    ready = null;
  }

  return Object.freeze({ previewAction, hide, close });
}
