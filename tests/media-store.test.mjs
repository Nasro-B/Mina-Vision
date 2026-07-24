import { describe, expect, it, vi } from 'vitest';
import { createMediaStore } from '../src/chat/media-store.mjs';

function memoryFs() {
  const files = new Map();
  return {
    files,
    mkdir: vi.fn(async () => {}),
    writeFile: vi.fn(async (p, data) => { files.set(p, data); }),
    readFile: vi.fn(async (p) => { if (!files.has(p)) throw new Error('ENOENT'); return files.get(p); }),
    rename: vi.fn(async (from, to) => { files.set(to, files.get(from)); files.delete(from); }),
  };
}

describe('media store — stockage chiffré au repos (extras chat P6)', () => {
  it('save puis load redonne mime + octets, et le disque ne contient PAS le clair', async () => {
    const fs = memoryFs();
    const store = createMediaStore({ directory: 'C:/x/media', key: Buffer.alloc(32, 5), ...fs, now: () => 1 });
    const bytes = Buffer.from('contenu binaire secret de la photo');
    await store.save('M1', 'image/jpeg', bytes);

    const onDisk = fs.files.get('C:/x/media/M1.media');
    expect(onDisk).not.toContain('secret');
    expect(onDisk).toContain('ciphertext');

    const loaded = await store.load('M1');
    expect(loaded.mime).toBe('image/jpeg');
    expect(loaded.bytes.equals(bytes)).toBe(true);
  });

  it('load rend null sur fichier absent ou altéré (jamais un octet douteux)', async () => {
    const fs = memoryFs();
    const store = createMediaStore({ directory: 'C:/x', key: Buffer.alloc(32, 1), ...fs });
    expect(await store.load('absent')).toBeNull();
    fs.files.set('C:/x/M2.media', JSON.stringify({ mime: 'image/png', envelope: { version: 1, nonce: 'AAAA', ciphertext: 'AAAA', authTag: 'AAAA' } }));
    expect(await store.load('M2')).toBeNull();
  });

  it('une mauvaise clé ne peut pas lire le média d\'une autre', async () => {
    const fs = memoryFs();
    const good = createMediaStore({ directory: 'C:/x', key: Buffer.alloc(32, 7), ...fs });
    await good.save('M3', 'audio/mp4', Buffer.from('audio'));
    const wrong = createMediaStore({ directory: 'C:/x', key: Buffer.alloc(32, 8), ...fs });
    expect(await wrong.load('M3')).toBeNull();
  });

  it('refuse une clé non-32 octets et un mediaId invalide', async () => {
    const fs = memoryFs();
    expect(() => createMediaStore({ directory: 'x', key: Buffer.alloc(16), ...fs })).toThrow('media_store_key_invalid');
    const store = createMediaStore({ directory: 'x', key: Buffer.alloc(32), ...fs });
    await expect(store.save('bad/id!', 'image/png', Buffer.from('x'))).rejects.toThrow('media_id_invalide');
  });
});
