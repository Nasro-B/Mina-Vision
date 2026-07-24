import { describe, expect, it, vi } from 'vitest';
import { composeBackupDomain, deriveBackupKeyFromMaster } from '../src/backup/compose-backup-domain.mjs';

const MASTER = Buffer.alloc(32, 7);

function fakeClient() {
  const store = new Map();
  return {
    authenticate: vi.fn(async () => ({ ownerId: 'owner-1' })),
    put: vi.fn(async (path, bytes) => { store.set(path, Buffer.from(bytes)); }),
    get: vi.fn(async (path) => store.get(path) ?? null),
    exists: vi.fn(async (path) => store.has(path)),
    delete: vi.fn(async (path) => { store.delete(path); }),
    list: vi.fn(async () => [...store.keys()]),
  };
}

describe('compose backup domain (réconciliation T16 — enfin composé)', () => {
  it('FAIL-HONEST : sans configuration Firebase → disabled avec raison, jamais de fausse promesse', async () => {
    const result = await composeBackupDomain({ masterKey: MASTER, configured: false });
    expect(result).toMatchObject({ state: 'disabled', reason: 'firebase_non_configure', backup: null, restore: null });
  });

  it('configuré mais dépendances incomplètes → disabled explicite', async () => {
    const result = await composeBackupDomain({ masterKey: MASTER, configured: true });
    expect(result).toMatchObject({ state: 'disabled', reason: 'backup_dependances_incompletes' });
  });

  it('configuré + dépendances complètes → operational, services backup/restore réels', async () => {
    const result = await composeBackupDomain({
      masterKey: MASTER,
      configured: true,
      createClient: async () => fakeClient(),
      authTokenProvider: async () => 'valid-token',
      expectedOwnerId: 'owner-1',
      deviceId: 'pc-1',
    });
    expect(result.state).toBe('operational');
    expect(typeof result.backup.backup).toBe('function');
    expect(typeof result.restore.restore).toBe('function');
  });

  it('Firebase injoignable (createClient throw) → degraded HONNÊTE, jamais un crash', async () => {
    const result = await composeBackupDomain({
      masterKey: MASTER,
      configured: true,
      createClient: async () => { throw new Error('network_down'); },
      authTokenProvider: async () => 'valid-token',
      expectedOwnerId: 'owner-1',
      deviceId: 'pc-1',
    });
    expect(result.state).toBe('degraded');
    expect(result.reason).toMatch(/backup_indisponible:.*network_down/u);
  });

  it('la clé de sauvegarde est dérivée (≠ clé maître) et exige 32 octets', () => {
    const derived = deriveBackupKeyFromMaster(MASTER);
    expect(derived.length).toBe(32);
    expect(derived.equals(MASTER)).toBe(false);
    expect(() => deriveBackupKeyFromMaster(Buffer.alloc(16))).toThrow('backup_master_key_required');
  });
});
