import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { registerMinaIpc } from '../src/ui/ipc/register-ipc.mjs';

describe('Electron hardening: BrowserWindow webPreferences', () => {
  it('main.mjs enables contextIsolation, disables nodeIntegration, and enables the OS sandbox', async () => {
    const source = await readFile('src/ui/main.mjs', 'utf8');
    expect(source).toMatch(/contextIsolation:\s*true/u);
    expect(source).toMatch(/nodeIntegration:\s*false/u);
    expect(source).toMatch(/sandbox:\s*true/u);
  });
});

describe('Electron hardening: navigation and new windows blocked, no allowlist needed', () => {
  it('main.mjs denies every window-open request', async () => {
    const source = await readFile('src/ui/main.mjs', 'utf8');
    expect(source).toMatch(/setWindowOpenHandler\(\s*\(\)\s*=>\s*\(\{\s*action:\s*'deny'\s*\}\)\)/u);
  });

  it('main.mjs prevents will-navigate away from the loaded app URL', async () => {
    const source = await readFile('src/ui/main.mjs', 'utf8');
    expect(source).toMatch(/will-navigate/u);
    expect(source).toMatch(/event\.preventDefault\(\)/u);
  });
});

describe('Electron hardening: strict CSP', () => {
  it('index.html declares a CSP with no unsafe-inline or unsafe-eval', async () => {
    const source = await readFile('src/ui/index.html', 'utf8');
    const match = source.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/u);
    expect(match).toBeTruthy();
    const csp = match[1];
    expect(csp).not.toContain('unsafe-inline');
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).toContain("default-src 'self'");
  });
});

describe('Electron single-instance: a dead window must never swallow the desktop-icon click', () => {
  it('second-instance recreates the window when the holder has none to show', async () => {
    // Regression: zombie main process + destroyed window → new launch quits on the lock, holder
    // returned silently — the desktop icon then did nothing at all.
    const source = await readFile('src/ui/main.mjs', 'utf8');
    const handler = source.match(/app\.on\('second-instance',[\s\S]{0,600}?\}\);/u)?.[0];
    expect(handler).toBeTruthy();
    expect(handler).toContain('createWindow');
    expect(handler).not.toMatch(/isDestroyed\(\)\)\s*return;/u);
  });
});

describe('Electron hardening: permission handler stays deny-by-default', () => {
  it('grants only media (microphone) and fullscreen (voice animation), never anything sensitive', async () => {
    const source = await readFile('src/ui/main.mjs', 'utf8');
    const match = source.match(/const ALLOWED_PERMISSIONS = new Set\(\[([^\]]*)\]\)/u);
    expect(match).not.toBeNull();
    const granted = match[1].split(',').map((entry) => entry.trim().replace(/['"]/gu, '')).filter(Boolean);
    expect(granted.sort()).toEqual(['fullscreen', 'media']);
    // The decision must be membership in that closed set — never a blanket allow.
    expect(source).toMatch(/callback\(ALLOWED_PERMISSIONS\.has\(permission\)\)/u);
    expect(source).not.toMatch(/callback\(true\)/u);
  });

  it('never grants permissions that would expose the machine or the owner', async () => {
    const source = await readFile('src/ui/main.mjs', 'utf8');
    const match = source.match(/const ALLOWED_PERMISSIONS = new Set\(\[([^\]]*)\]\)/u);
    const granted = match[1];
    for (const dangerous of ['geolocation', 'notifications', 'midi', 'pointerLock', 'openExternal', 'clipboard-read']) {
      expect(granted).not.toContain(dangerous);
    }
  });
});

describe('registerMinaIpc: optional sender-frame and payload-size guards', () => {
  // coreChannels are only reserved in the allowlist (main.mjs wires their real ipcMain.handle calls
  // itself, outside registerMinaIpc) — the guarded wrapper only ever applies to channels registered
  // through a DOMAIN_REGISTRARS controller, so that's what these tests exercise.
  function fakeIpcMain() {
    const handlers = new Map();
    return {
      handlers,
      handle: vi.fn((channel, handler) => handlers.set(channel, handler)),
    };
  }

  function fakeApprovalController() {
    return {
      remoteApprove: vi.fn(async () => ({ decision: 'pending' })),
      approve: vi.fn(async () => ({})),
      deny: vi.fn(async () => ({})),
      consume: vi.fn(async () => ({})),
      get: vi.fn(async () => ({})),
    };
  }

  it('defaults (no guards configured) preserve identical behavior for every existing caller', () => {
    const ipcMain = fakeIpcMain();
    expect(() => registerMinaIpc({ ipcMain, controllers: { approval: fakeApprovalController() } })).not.toThrow();
  });

  it('rejects a call from a sender the caller marks invalid, once isValidSender is configured', async () => {
    const ipcMain = fakeIpcMain();
    registerMinaIpc({ ipcMain, controllers: { approval: fakeApprovalController() }, isValidSender: (event) => event?.senderFrame === 'main' });
    const handler = ipcMain.handlers.get('mina:approvals:get');
    await expect(handler({ senderFrame: 'popup' })).rejects.toThrow('ipc_sender_frame_rejected:mina:approvals:get');
    await expect(handler({ senderFrame: 'main' })).resolves.toBeDefined();
  });

  it('rejects an oversized payload once maxPayloadBytes is configured, accepts a small one', async () => {
    const ipcMain = fakeIpcMain();
    registerMinaIpc({ ipcMain, controllers: { approval: fakeApprovalController() }, maxPayloadBytes: 20 });
    const handler = ipcMain.handlers.get('mina:approvals:remote-approve');
    await expect(handler({}, { goal: 'x'.repeat(100) })).rejects.toThrow('ipc_payload_too_large:mina:approvals:remote-approve');
    await expect(handler({}, { small: 'ok' })).resolves.toBeDefined();
  });

  it('rejects a non-function isValidSender', () => {
    expect(() => registerMinaIpc({ ipcMain: fakeIpcMain(), isValidSender: 'not-a-function' })).toThrow('register_ipc_sender_validator_invalid');
  });
});
