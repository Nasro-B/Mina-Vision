import { describe, expect, it, vi } from 'vitest';
import { registerAnalyticsIpc } from '../src/ui/ipc/analytics-ipc.mjs';

describe('analytics IPC', () => {
  it('registers only query, budgets and export with validated object payloads', async () => {
    const handlers = new Map();
    const ipcMain = { handle: vi.fn((channel, handler) => handlers.set(channel, handler)), removeHandler: vi.fn() };
    const controller = {
      query: vi.fn(async (payload) => ({ kind: 'query', payload })),
      budgetSnapshot: vi.fn(async (payload) => ({ kind: 'budget', payload })),
      export: vi.fn(async (payload) => ({ kind: 'export', payload })),
    };
    const registration = registerAnalyticsIpc({ ipcMain, controller });

    expect([...handlers.keys()]).toEqual([
      'mina:analytics:query', 'mina:analytics:budgets', 'mina:analytics:export',
    ]);
    await expect(handlers.get('mina:analytics:query')({}, { page: 1 })).resolves.toMatchObject({ kind: 'query' });
    await expect(handlers.get('mina:analytics:budgets')({}, { type: 'daily' })).resolves.toMatchObject({ kind: 'budget' });
    await expect(handlers.get('mina:analytics:export')({}, { format: 'json' })).resolves.toMatchObject({ kind: 'export' });
    await expect(handlers.get('mina:analytics:query')({}, [])).rejects.toThrow('analytics_ipc_payload_invalid');

    registration.dispose();
    expect(ipcMain.removeHandler).toHaveBeenCalledTimes(3);
  });
});
