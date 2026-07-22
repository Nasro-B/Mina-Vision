import { describe, expect, it, vi } from 'vitest';
import { registerSettingsIpc } from '../src/ui/ipc/settings-ipc.mjs';

describe('settings IPC', () => {
  it('registers only explicit channels and validates secret payloads in main process', async () => {
    const handlers = new Map();
    const ipcMain = { handle: vi.fn((name, handler) => handlers.set(name, handler)) };
    const controller = {
      getSchema: vi.fn(() => ({})), getState: vi.fn(async () => ({})), update: vi.fn(async () => ({})),
      setSecret: vi.fn(async () => ({})), revokeSecret: vi.fn(async () => ({})), testProvider: vi.fn(async () => ({})),
    };
    registerSettingsIpc({ ipcMain, controller });

    expect([...handlers.keys()]).toEqual([
      'mina:settings:get-schema', 'mina:settings:get', 'mina:settings:update',
      'mina:settings:set-secret', 'mina:settings:revoke-secret', 'mina:settings:test-provider',
    ]);
    await expect(handlers.get('mina:settings:set-secret')({}, { providerId: 'gemini', value: '' }))
      .rejects.toThrow('settings_secret_invalid');
    await handlers.get('mina:settings:set-secret')({}, { providerId: 'gemini', value: 'x' });
    expect(controller.setSecret).toHaveBeenCalledWith({ providerId: 'gemini', value: 'x' });
  });
});
