import { describe, expect, it, vi } from 'vitest';
import { PUBLICATION_CHANNELS, registerPublicationIpc } from '../src/publication/publication-ipc.mjs';

function fakeIpc() {
  const handlers = new Map();
  return {
    handle: (channel, fn) => handlers.set(channel, fn),
    invoke: (channel, payload) => handlers.get(channel)?.({}, payload),
    channels: () => [...handlers.keys()],
  };
}

describe('publication-ipc', () => {
  it('enregistre EXACTEMENT les 5 canaux publication', () => {
    const ipc = fakeIpc();
    const result = registerPublicationIpc({ ipcMain: ipc, buildService: () => ({ publish: async () => ({}) }) });
    expect(ipc.channels().sort()).toEqual([...PUBLICATION_CHANNELS].sort());
    expect(result.channels).toHaveLength(5);
  });

  it('publish : une destination absolue est refusée (code stable, jamais de stack)', async () => {
    const ipc = fakeIpc();
    const publish = vi.fn(async (request) => {
      if (/^[a-zA-Z]:[\\/]/u.test(request.destination ?? '')) throw new Error('publication_destination_absolute_forbidden: C:/x');
      return { format: 'pdf', bytes: 1, sha256: 'a'.repeat(64), filePath: 'ok', assets: [] };
    });
    registerPublicationIpc({ ipcMain: ipc, buildService: () => ({ publish }) });

    const bad = await ipc.invoke('mina:publication:publish', { format: 'pdf', destination: 'C:/Windows/x.pdf' });
    expect(bad).toEqual({ ok: false, error: 'publication_destination_absolute_forbidden' });
    const good = await ipc.invoke('mina:publication:publish', { format: 'pdf' });
    expect(good.ok).toBe(true);
  });

  it('assets:import ne renvoie JAMAIS les bytes ni le chemin source au renderer', async () => {
    const ipc = fakeIpc();
    registerPublicationIpc({
      ipcMain: ipc, buildService: () => ({ publish: async () => ({}) }),
      importAsset: async () => ({ assetId: 'a', mimeType: 'image/png', provenance: 'user-file', sha256: 'b'.repeat(64), dimensions: { width: 1, height: 1 }, bytes: Buffer.from('secret'), path: 'C:/secret.png' }),
    });
    const result = await ipc.invoke('mina:publication:assets:import', { sourcePath: 'x', sourceKind: 'user-file' });
    expect(result.ok).toBe(true);
    expect(result.asset).not.toHaveProperty('bytes');
    expect(result.asset).not.toHaveProperty('path');
    expect(result.asset).toMatchObject({ assetId: 'a', provenance: 'user-file' });
  });

  it('convert sans convertisseur configuré → libreoffice_unavailable', async () => {
    const ipc = fakeIpc();
    registerPublicationIpc({ ipcMain: ipc, buildService: () => ({ publish: async () => ({}) }) });
    expect(await ipc.invoke('mina:publication:convert', { inputPath: 'x.docx', outputFormat: 'pdf', outputDirectory: 'o' }))
      .toEqual({ ok: false, error: 'libreoffice_unavailable' });
  });

  it('exige ipcMain + buildService', () => {
    expect(() => registerPublicationIpc({})).toThrow('publication_ipc_dependencies_required');
  });
});
