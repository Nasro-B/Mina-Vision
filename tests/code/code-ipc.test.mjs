import { describe, expect, it } from 'vitest';
import { registerCodeIpc } from '../../src/ui/code/code-ipc.mjs';

function createFakeIpcMain() {
  const handlers = new Map();
  return {
    handlers,
    handle: (channel, handler) => handlers.set(channel, handler),
    invoke: (channel, request) => {
      const handler = handlers.get(channel);
      if (!handler) throw new Error(`canal inconnu: ${channel}`);
      return handler({}, request);
    },
  };
}

function fakeServices({ isRepo = true } = {}) {
  return {
    projectRoot: 'C:/p',
    indexer: {
      fullIndex: async () => ({ indexed: 3, skipped: 0, total: 3, errors: [] }),
      status: () => ({ indexedFiles: 3, symbols: 12, lastIndexedAt: 'x' }),
      impactAnalysis: (file) => ({ changedFile: file, affectedFiles: [], riskLevel: 'faible' }),
      indexedFiles: () => ['src/a.mjs'],
    },
    projectContext: async () => ({ framework: 'Electron' }),
    search: { search: async (query, options) => [{ query, options }] },
    gitClient: { isRepository: async () => isRepo },
    gitStatus: { status: async () => ({ branch: 'main', clean: true }) },
    gitLog: { log: async ({ maxCount }) => Array(Math.min(maxCount, 2)).fill({ shortHash: 'abc' }) },
    gitDiff: { diff: async ({ staged }) => (staged ? 'diff staged' : 'diff worktree') },
    reviewer: { review: async ({ files }) => ({ files, findings: [], clean: true }) },
    testRunner: {
      runAll: async () => ({ passed: 10, failed: 0 }),
      runFile: async (file) => ({ passed: 1, failed: 0, file }),
    },
    planStore: { list: async () => [{ id: 'p1' }] },
  };
}

describe('code-ipc', () => {
  it('exige ipcMain et buildServices', () => {
    expect(() => registerCodeIpc({})).toThrow(/ipc_main_required/u);
    expect(() => registerCodeIpc({ ipcMain: createFakeIpcMain() })).toThrow(/build_services_required/u);
  });

  it('enregistre tous les canaux mina:code:* et construit les services UNE seule fois (paresseux)', async () => {
    const ipcMain = createFakeIpcMain();
    let builds = 0;
    registerCodeIpc({ ipcMain, buildServices: () => { builds += 1; return fakeServices(); } });
    expect([...ipcMain.handlers.keys()].every((channel) => channel.startsWith('mina:code:'))).toBe(true);
    expect(ipcMain.handlers.size).toBe(10);
    expect(builds).toBe(0);
    await ipcMain.invoke('mina:code:status');
    await ipcMain.invoke('mina:code:index');
    expect(builds).toBe(1);
  });

  it('status combine index, racine et framework', async () => {
    const ipcMain = createFakeIpcMain();
    registerCodeIpc({ ipcMain, buildServices: () => fakeServices() });
    const result = await ipcMain.invoke('mina:code:status');
    expect(result).toEqual({
      ok: true,
      data: { index: { indexedFiles: 3, symbols: 12, lastIndexedAt: 'x' }, projectRoot: 'C:/p', framework: 'Electron' },
    });
  });

  it('search borne maxResults, tests-run route runAll/runFile', async () => {
    const ipcMain = createFakeIpcMain();
    registerCodeIpc({ ipcMain, buildServices: () => fakeServices() });
    const search = await ipcMain.invoke('mina:code:search', { query: 'jwt', maxResults: 999 });
    expect(search.data[0].options.maxResults).toBe(50);
    const all = await ipcMain.invoke('mina:code:tests-run', {});
    expect(all.data.passed).toBe(10);
    const one = await ipcMain.invoke('mina:code:tests-run', { file: 'tests/a.test.mjs' });
    expect(one.data.file).toBe('tests/a.test.mjs');
  });

  it('hors dépôt git → notRepository true sans erreur', async () => {
    const ipcMain = createFakeIpcMain();
    registerCodeIpc({ ipcMain, buildServices: () => fakeServices({ isRepo: false }) });
    expect((await ipcMain.invoke('mina:code:git-status')).data).toEqual({ notRepository: true });
    expect((await ipcMain.invoke('mina:code:git-log')).data).toEqual({ notRepository: true, log: [] });
    expect((await ipcMain.invoke('mina:code:git-diff')).data).toEqual({ notRepository: true, diff: '' });
  });

  it('review sans fichiers ET sans index → erreur nominée encapsulée { ok:false }', async () => {
    const ipcMain = createFakeIpcMain();
    const services = fakeServices();
    services.indexer.indexedFiles = () => [];
    const events = [];
    registerCodeIpc({ ipcMain, buildServices: () => services, onEvent: (event) => events.push(event) });
    const result = await ipcMain.invoke('mina:code:review', {});
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/review_no_files/u);
    expect(events[0].type).toBe('code_ipc_error');
  });

  it('toute exception de service est encapsulée, jamais propagée à travers l\'IPC', async () => {
    const ipcMain = createFakeIpcMain();
    const services = fakeServices();
    services.indexer.fullIndex = async () => { throw new Error('disque plein'); };
    registerCodeIpc({ ipcMain, buildServices: () => services });
    const result = await ipcMain.invoke('mina:code:index');
    expect(result).toEqual({ ok: false, error: 'disque plein' });
  });
});
