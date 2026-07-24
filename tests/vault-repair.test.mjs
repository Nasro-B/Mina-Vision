import { describe, it, expect } from 'vitest';
import { createVaultRepair } from '../src/memory/vault-repair.mjs';

const NOW = 1_784_900_000_000;

function harness({ keyringContent = null, decrypt = () => 'ok', existing = new Set() } = {}) {
  const renamed = [];
  const files = new Map();
  if (keyringContent !== null) files.set('C:/vault/mina-keyring.json', keyringContent);
  const repair = createVaultRepair({
    safeStorage: { decryptString: (buf) => { const r = decrypt(buf); if (r instanceof Error) throw r; return r; } },
    keyringPath: 'C:/vault/mina-keyring.json',
    archiveTargets: ['C:/vault/mina-memory.sqlite', 'C:/vault/mina-memory.sqlite-wal'],
    readFile: async (p) => { if (!files.has(p)) { const e = new Error('nope'); e.code = 'ENOENT'; throw e; } return files.get(p); },
    rename: async (from, to) => { renamed.push([from, to]); },
    access: async (p) => { if (!existing.has(p)) { const e = new Error('absent'); e.code = 'ENOENT'; throw e; } },
    now: () => NOW,
  });
  return { repair, renamed };
}

const healthyKeyring = JSON.stringify({ wrappedMasterKey: Buffer.from('x'.repeat(32)).toString('base64') });

describe('createVaultRepair.probe', () => {
  it('uninitialized quand aucun keyring', async () => {
    const { repair } = harness({ keyringContent: null });
    expect((await repair.probe()).state).toBe('uninitialized');
  });

  it('healthy quand DPAPI déchiffre', async () => {
    const { repair } = harness({ keyringContent: healthyKeyring, decrypt: () => 'ok' });
    expect((await repair.probe()).state).toBe('healthy');
  });

  it('dpapi_unrecoverable quand le déchiffrement lève', async () => {
    const { repair } = harness({ keyringContent: healthyKeyring, decrypt: () => new Error('Error while decrypting') });
    const state = await repair.probe();
    expect(state.state).toBe('dpapi_unrecoverable');
    expect(state.reason).toContain('decrypting');
  });

  it('corrupt quand wrappedMasterKey absent', async () => {
    const { repair } = harness({ keyringContent: JSON.stringify({ foo: 1 }) });
    expect((await repair.probe()).state).toBe('corrupt');
  });
});

describe('createVaultRepair.archiveUnrecoverable', () => {
  it('REFUSE d’archiver un coffre sain (garde interne, ne fait pas confiance à l’appelant)', async () => {
    const { repair, renamed } = harness({ keyringContent: healthyKeyring, decrypt: () => 'ok' });
    await expect(repair.archiveUnrecoverable()).rejects.toThrow('vault_repair_refuse:healthy');
    expect(renamed).toEqual([]);
  });

  it('archive keyring + mémoire existants sous un suffixe daté, sans rien supprimer', async () => {
    const { repair, renamed } = harness({
      keyringContent: healthyKeyring,
      decrypt: () => new Error('Error while decrypting'),
      existing: new Set(['C:/vault/mina-keyring.json', 'C:/vault/mina-memory.sqlite', 'C:/vault/mina-memory.sqlite-wal']),
    });
    const result = await repair.archiveUnrecoverable();
    expect(result.archived).toEqual([
      'C:/vault/mina-keyring.json',
      'C:/vault/mina-memory.sqlite',
      'C:/vault/mina-memory.sqlite-wal',
    ]);
    expect(result.suffix).toMatch(/^\.perdu-dpapi-2026-/);
    // renommages, jamais de suppression
    expect(renamed.every(([, to]) => to.includes('.perdu-dpapi-'))).toBe(true);
  });

  it('n’archive que les fichiers présents (mémoire absente ignorée)', async () => {
    const { repair, renamed } = harness({
      keyringContent: healthyKeyring,
      decrypt: () => new Error('Error while decrypting'),
      existing: new Set(['C:/vault/mina-keyring.json']), // mémoire absente
    });
    const result = await repair.archiveUnrecoverable();
    expect(result.archived).toEqual(['C:/vault/mina-keyring.json']);
    expect(renamed).toHaveLength(1);
  });
});
