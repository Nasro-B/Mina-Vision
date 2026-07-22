// Sauvegarde/restauration de fichiers avant édition : copie « .mina-backup » à côté du fichier,
// restauration atomique, nettoyage explicite. Aucune édition sans backup préalable possible.

const BACKUP_SUFFIX = '.mina-backup';

export function createFileBackup({ fs } = {}) {
  if (!fs || typeof fs.readFile !== 'function' || typeof fs.writeFile !== 'function' || typeof fs.rm !== 'function') {
    throw new TypeError('file_backup_fs_required');
  }
  const backups = new Map();

  const backupPath = (filePath) => `${filePath}${BACKUP_SUFFIX}`;

  return Object.freeze({
    async backup(filePath) {
      if (typeof filePath !== 'string' || filePath.length === 0) throw new Error('file_backup_path_required');
      let content;
      try {
        content = String(await fs.readFile(filePath, 'utf8'));
      } catch (error) {
        throw new Error(`file_backup_read_failed: ${error.message}`);
      }
      await fs.writeFile(backupPath(filePath), content, 'utf8');
      backups.set(filePath, content);
      return Object.freeze({ filePath, backupPath: backupPath(filePath) });
    },

    async restore(filePath) {
      let content = backups.get(filePath);
      if (content === undefined) {
        try {
          content = String(await fs.readFile(backupPath(filePath), 'utf8'));
        } catch (error) {
          throw new Error(`file_backup_missing: ${error.message}`);
        }
      }
      await fs.writeFile(filePath, content, 'utf8');
      return Object.freeze({ filePath, restored: true });
    },

    async discard(filePath) {
      backups.delete(filePath);
      try {
        await fs.rm(backupPath(filePath), { force: true });
      } catch {
        // Le nettoyage est best-effort : un backup orphelin n'est jamais bloquant.
      }
    },

    hasBackup: (filePath) => backups.has(filePath),
    list: () => Object.freeze([...backups.keys()]),
  });
}
