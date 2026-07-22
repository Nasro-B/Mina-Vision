import { describe, expect, it } from 'vitest';
import { createFileBackup } from '../../src/code/editing/file-backup.mjs';

function createMemFs(initial = {}) {
  const files = new Map(Object.entries(initial));
  return {
    files,
    readFile: async (path) => {
      if (!files.has(path)) throw new Error(`ENOENT: ${path}`);
      return files.get(path);
    },
    writeFile: async (path, content) => { files.set(path, content); },
    rm: async (path) => { files.delete(path); },
  };
}

describe('file-backup', () => {
  it('exige un fs injecté et un chemin', async () => {
    expect(() => createFileBackup()).toThrow(/file_backup_fs_required/u);
    const backup = createFileBackup({ fs: createMemFs() });
    await expect(backup.backup('')).rejects.toThrow(/file_backup_path_required/u);
  });

  it('backup copie le contenu vers .mina-backup et mémorise', async () => {
    const memFs = createMemFs({ 'a.mjs': 'v1' });
    const backup = createFileBackup({ fs: memFs });
    const result = await backup.backup('a.mjs');
    expect(result.backupPath).toBe('a.mjs.mina-backup');
    expect(memFs.files.get('a.mjs.mina-backup')).toBe('v1');
    expect(backup.hasBackup('a.mjs')).toBe(true);
    expect(backup.list()).toEqual(['a.mjs']);
  });

  it('backup d\'un fichier illisible → erreur nominée', async () => {
    const backup = createFileBackup({ fs: createMemFs() });
    await expect(backup.backup('absent.mjs')).rejects.toThrow(/file_backup_read_failed/u);
  });

  it('restore remet le contenu sauvegardé (depuis la mémoire)', async () => {
    const memFs = createMemFs({ 'a.mjs': 'v1' });
    const backup = createFileBackup({ fs: memFs });
    await backup.backup('a.mjs');
    memFs.files.set('a.mjs', 'v2-cassée');
    await backup.restore('a.mjs');
    expect(memFs.files.get('a.mjs')).toBe('v1');
  });

  it('restore retombe sur le fichier .mina-backup disque si la mémoire est vide', async () => {
    const memFs = createMemFs({ 'a.mjs': 'corrompu', 'a.mjs.mina-backup': 'v1' });
    const backup = createFileBackup({ fs: memFs });
    await backup.restore('a.mjs');
    expect(memFs.files.get('a.mjs')).toBe('v1');
  });

  it('restore sans aucun backup → erreur nominée', async () => {
    const backup = createFileBackup({ fs: createMemFs({ 'a.mjs': 'x' }) });
    await expect(backup.restore('a.mjs')).rejects.toThrow(/file_backup_missing/u);
  });

  it('discard supprime le fichier backup et l\'entrée mémoire, sans jamais lever', async () => {
    const memFs = createMemFs({ 'a.mjs': 'v1' });
    const backup = createFileBackup({ fs: memFs });
    await backup.backup('a.mjs');
    await backup.discard('a.mjs');
    expect(backup.hasBackup('a.mjs')).toBe(false);
    expect(memFs.files.has('a.mjs.mina-backup')).toBe(false);
    await expect(backup.discard('jamais-vu.mjs')).resolves.toBeUndefined();
  });
});
