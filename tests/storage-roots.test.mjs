import { describe, expect, it } from 'vitest';
import { resolveStorageRoots } from '../src/system/storage-roots.mjs';

const USER_DATA = 'C:\\Users\\Exemple\\AppData\\Roaming\\Mina Vision';

describe('racines de stockage portables', () => {
  it('exige le userData — jamais de chemin deviné', () => {
    expect(() => resolveStorageRoots({})).toThrow('storage_roots_user_data_required');
  });

  it('par défaut, TOUT vit sous le userData : l\'app démarre sur n\'importe quelle machine', () => {
    const roots = resolveStorageRoots({ userDataPath: USER_DATA, env: {} });
    expect(roots.cacheRoot).toContain(USER_DATA);
    expect(roots.modelsRoot).toContain(USER_DATA);
    expect(roots.sandboxRoot).toContain(USER_DATA);
    expect(roots.sandboxRuntimeRoot).toContain(USER_DATA);
    // Aucune racine de confiance héritée d'une autre installation.
    expect(roots.extraTrustedRoots).toEqual([]);
  });

  it('une racine commune déporte tout d\'un seul réglage', () => {
    const roots = resolveStorageRoots({ userDataPath: USER_DATA, env: { MINA_CACHE_ROOT: 'D:\\caches\\Mina' } });
    expect(roots.cacheRoot).toBe('D:\\caches\\Mina');
    expect(roots.modelsRoot).toContain('D:\\caches\\Mina');
    expect(roots.sandboxRoot).toContain('D:\\caches\\Mina');
  });

  it('chaque racine reste surchargeable individuellement', () => {
    const roots = resolveStorageRoots({
      userDataPath: USER_DATA,
      env: { MINA_CACHE_ROOT: 'D:\\caches', MINA_MODELS_ROOT: 'E:\\models', MINA_SANDBOX_ROOT: 'F:\\sandbox' },
    });
    expect(roots.modelsRoot).toBe('E:\\models');
    expect(roots.sandboxRoot).toBe('F:\\sandbox');
    expect(roots.sandboxRuntimeRoot).toContain('D:\\caches');
  });

  it('les racines d\'écriture supplémentaires sont explicites et nettoyées', () => {
    const roots = resolveStorageRoots({
      userDataPath: USER_DATA,
      env: { MINA_TRUSTED_WRITE_ROOTS: 'D:\\Travail ; ;E:\\Partage ' },
    });
    expect(roots.extraTrustedRoots).toEqual(['D:\\Travail', 'E:\\Partage']);
  });

  it('une variable vide ou blanche retombe sur le défaut portable', () => {
    const roots = resolveStorageRoots({ userDataPath: USER_DATA, env: { MINA_CACHE_ROOT: '   ' } });
    expect(roots.cacheRoot).toContain(USER_DATA);
  });
});
