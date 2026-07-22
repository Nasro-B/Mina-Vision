import { describe, expect, it, vi } from 'vitest';
import { registerMinaIpc } from '../src/ui/ipc/register-ipc.mjs';

function fakeIpcMain() {
  const handlers = new Map();
  return { handle: vi.fn((channel, handler) => handlers.set(channel, handler)), handlers };
}

const controllers = Object.freeze({
  skillsSandbox: {
    status: vi.fn(), chooseAndStageSkill: vi.fn(), installSkill: vi.fn(),
    executeSandbox: vi.fn(), cancelSandbox: vi.fn(), importArtifact: vi.fn(),
  },
  mail: {
    listAccounts: vi.fn(), pauseAccount: vi.fn(), resumeAccount: vi.fn(), search: vi.fn(),
    proposeDraft: vi.fn(), proposeSend: vi.fn(), commit: vi.fn(),
  },
  home: {
    connectorHealth: vi.fn(), requestPermission: vi.fn(), discover: vi.fn(), list: vi.fn(),
    resolve: vi.fn(), editDevice: vi.fn(), execute: vi.fn(), auditHistory: vi.fn(),
  },
  camera: {
    status: vi.fn(), start: vi.fn(), stop: vi.fn(), switchLens: vi.fn(),
    nextPreviewFrame: vi.fn(), enroll: vi.fn(), deleteProfile: vi.fn(),
  },
});

describe('registerMinaIpc: single allowlist across every domain', () => {
  it('registers the full channel list with no duplicates and no wildcards', () => {
    const ipcMain = fakeIpcMain();
    const result = registerMinaIpc({ ipcMain, controllers });

    expect(result.channels.length).toBe(new Set(result.channels).size);
    expect(result.channels.every((channel) => !channel.includes('*') && !channel.includes('?'))).toBe(true);
    expect(result.channels).toContain('mina:mail:list-accounts');
    expect(result.channels).toContain('mina:home:execute');
    expect(result.channels).toContain('mina:camera:enroll');
    expect(result.channels).toContain('mina:session-state');
  });

  it('rejects a core channel list containing a wildcard instead of silently accepting it', () => {
    const ipcMain = fakeIpcMain();
    expect(() => registerMinaIpc({ ipcMain, controllers, coreChannels: ['mina:*'] }))
      .toThrow('ipc_channel_wildcard_forbidden');
  });

  it('rejects a duplicate channel between the core list and a domain module', () => {
    const ipcMain = fakeIpcMain();
    expect(() => registerMinaIpc({ ipcMain, controllers, coreChannels: ['mina:mail:list-accounts'] }))
      .toThrow('ipc_channel_duplicate');
  });

  it('skips a domain entirely when its controller was not constructed (degraded), without crashing', () => {
    const ipcMain = fakeIpcMain();
    const result = registerMinaIpc({ ipcMain, controllers: { skillsSandbox: controllers.skillsSandbox } });
    expect(result.channels).not.toContain('mina:mail:list-accounts');
    expect(result.channels).toContain('mina:skills-sandbox:status');
  });

  it('actually forwards registration to the real ipcMain for every channel', () => {
    const ipcMain = fakeIpcMain();
    registerMinaIpc({ ipcMain, controllers });
    expect(ipcMain.handlers.has('mina:mail:commit')).toBe(true);
    expect(ipcMain.handlers.has('mina:home:audit-history')).toBe(true);
  });
});
