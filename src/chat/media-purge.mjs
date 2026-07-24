// Purge temporisée des médias de chat stockés CHIFFRÉS côté PC (userData/chat-media, décision du
// plan extras chat : rétention 14 jours). Bornée et prudente par construction :
//   • ne touche QUE les fichiers `*.media` du répertoire donné — jamais de récursion, jamais un
//     autre suffixe, jamais un chemin hors du répertoire ;
//   • l'âge vient du mtime du fichier ; en cas de doute (stat impossible) on NE supprime PAS ;
//   • chaque suppression est journalisée — une purge silencieuse serait un mensonge par omission.

const DEFAULT_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

export function createMediaPurge({
  directory,
  readdir,
  stat,
  rm,
  maxAgeMs = DEFAULT_MAX_AGE_MS,
  clock = () => Date.now(),
  logger = null,
} = {}) {
  if (!directory || typeof readdir !== 'function' || typeof stat !== 'function' || typeof rm !== 'function') {
    throw new TypeError('media_purge_dependencies_required');
  }
  const boundedAge = Math.max(24 * 60 * 60 * 1000, Number(maxAgeMs) || DEFAULT_MAX_AGE_MS);

  return Object.freeze({
    async run() {
      let entries;
      try {
        entries = await readdir(directory);
      } catch {
        return Object.freeze({ scanned: 0, purged: 0, kept: 0 }); // répertoire absent : rien à faire
      }
      const cutoff = Number(clock()) - boundedAge;
      let purged = 0;
      let kept = 0;
      const names = entries.filter((name) => typeof name === 'string' && name.endsWith('.media') && !name.includes('/') && !name.includes('\\'));
      for (const name of names) {
        const target = `${directory}/${name}`;
        let info;
        try {
          info = await stat(target);
        } catch {
          kept += 1; // stat impossible : on garde (jamais de suppression au doute)
          continue;
        }
        if (Number(info?.mtimeMs ?? Number.POSITIVE_INFINITY) < cutoff) {
          try {
            await rm(target);
            purged += 1;
            logger?.append?.({ event: 'chat_media_purge', file: name });
          } catch (error) {
            kept += 1;
            logger?.append?.({ event: 'chat_media_purge_echec', file: name, error: String(error?.message ?? error).slice(0, 120) });
          }
        } else {
          kept += 1;
        }
      }
      const summary = Object.freeze({ scanned: names.length, purged, kept });
      if (purged > 0) logger?.append?.({ event: 'chat_media_purge_bilan', ...summary });
      return summary;
    },
  });
}

export { DEFAULT_MAX_AGE_MS as MEDIA_PURGE_MAX_AGE_MS };
