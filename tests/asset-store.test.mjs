import { describe, expect, it, vi } from 'vitest';
import { createAssetStore } from '../src/publication/asset-store.mjs';

const pad = (head, size = 16) => {
  const buffer = Buffer.alloc(size);
  Buffer.from(head).copy(buffer);
  return buffer;
};
const JPEG = pad([0xff, 0xd8, 0xff, 0xe0]);
const EXE = pad([0x4d, 0x5a, 0x90, 0x00]);

// sharp factice qui ENREGISTRE la chaîne rotate→resize→toBuffer (preuve du ré-encodage = EXIF retiré),
// et rend un buffer distinct de l'original + des dimensions bornées.
function fakeSharp(reencoded) {
  const calls = [];
  const factory = (input) => {
    calls.push({ input });
    const api = {
      rotate() { calls.push({ op: 'rotate' }); return api; },
      resize(w, h, opts) { calls.push({ op: 'resize', w, h, opts }); return api; },
      toBuffer: async () => reencoded,
      metadata: async () => ({ width: 3840, height: 2160 }),
    };
    return api;
  };
  factory.calls = calls;
  return factory;
}

function makeStore({ files, sharp } = {}) {
  const written = new Map();
  const store = createAssetStore({
    readFile: async (path) => {
      if (!(path in files)) throw new Error('enoent');
      return files[path];
    },
    writeFile: async (path, bytes) => { written.set(path, bytes); },
    mkdir: vi.fn(async () => {}),
    sharp,
    hash: (bytes) => `sha-${bytes.length}`,
    baseDir: '/base/assets',
    randomId: () => 'fixed-id',
    now: () => 1000,
  });
  return { store, written };
}

describe('asset-store : import local normalisé', () => {
  it('refuse un exécutable déguisé en .jpg', async () => {
    const { store } = makeStore({ files: { 'C:/tmp/photo.jpg.exe': EXE } });
    await expect(store.importLocal({ sourcePath: 'C:/tmp/photo.jpg.exe', sourceKind: 'user-file' }))
      .rejects.toThrow('publication_asset_media_type_invalid');
  });

  it('conserve la provenance et le mime réel d’une photo fournie, et ré-encode (EXIF retiré)', async () => {
    const reencoded = Buffer.from('reencoded-no-exif');
    const sharp = fakeSharp(reencoded);
    const { store, written } = makeStore({ files: { 'in/camera.jpg': JPEG }, sharp });

    const result = await store.importLocal({ sourcePath: 'in/camera.jpg', sourceKind: 'camera-huawei' });

    expect(result).toMatchObject({ provenance: 'camera-huawei', mimeType: 'image/jpeg', assetId: 'fixed-id' });
    expect(result.dimensions).toEqual({ width: 3840, height: 2160 });
    expect(result.sha256).toBe(`sha-${reencoded.length}`); // hash du buffer RÉ-ENCODÉ, pas de l'original
    expect(result.importedAt).toBe(1000);
    // Preuve du ré-encodage : rotate + resize appelés, et c'est le buffer sans EXIF qui est écrit.
    expect(sharp.calls.some((c) => c.op === 'rotate')).toBe(true);
    expect(sharp.calls.some((c) => c.op === 'resize')).toBe(true);
    expect(written.get(result.path)).toBe(reencoded);
    expect(result.path).toContain('fixed-id.jpg');
  });

  it('refuse une provenance inconnue avant même de lire le fichier', async () => {
    const { store } = makeStore({ files: {} });
    await expect(store.importLocal({ sourcePath: 'x', sourceKind: 'internet' }))
      .rejects.toThrow('publication_asset_source_kind_invalid');
  });

  it('exige toutes ses dépendances système', () => {
    expect(() => createAssetStore({})).toThrow('asset_store_dependencies_required');
  });
});
