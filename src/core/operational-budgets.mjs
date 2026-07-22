// Budgets opérationnels centralisés (amélioration D) : les bornes qui empêchent tout emballement
// — actions par mission, durée de mission, rétention du journal, tampon verrouillé de la couche
// sensible, bornes d'archives. UNE source, validée, gelée ; le catalogue les expose telles
// quelles au tableau de bord.

const DEFAULTS = Object.freeze({
  mission: Object.freeze({ maxActions: 40, timeoutMs: 900_000 }),
  journal: Object.freeze({ retentionDays: 7, maxEntryBytes: 4_000, lockedBufferMax: 200 }),
  archives: Object.freeze({ maxEntries: 500, maxTotalBytes: 20 * 1024 * 1024, maxExpansionRatio: 100 }),
  voice: Object.freeze({ micChunkBufferMax: 50 }),
});

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function composeOperationalBudgets({ mission = {}, journal = {}, archives = {}, voice = {} } = {}) {
  return Object.freeze({
    mission: Object.freeze({
      maxActions: positiveInteger(mission.maxActions, DEFAULTS.mission.maxActions),
      timeoutMs: positiveInteger(mission.timeoutMs, DEFAULTS.mission.timeoutMs),
    }),
    journal: Object.freeze({
      retentionDays: positiveInteger(journal.retentionDays, DEFAULTS.journal.retentionDays),
      maxEntryBytes: positiveInteger(journal.maxEntryBytes, DEFAULTS.journal.maxEntryBytes),
      lockedBufferMax: positiveInteger(journal.lockedBufferMax, DEFAULTS.journal.lockedBufferMax),
    }),
    archives: Object.freeze({
      maxEntries: positiveInteger(archives.maxEntries, DEFAULTS.archives.maxEntries),
      maxTotalBytes: positiveInteger(archives.maxTotalBytes, DEFAULTS.archives.maxTotalBytes),
      maxExpansionRatio: positiveInteger(archives.maxExpansionRatio, DEFAULTS.archives.maxExpansionRatio),
    }),
    voice: Object.freeze({
      micChunkBufferMax: positiveInteger(voice.micChunkBufferMax, DEFAULTS.voice.micChunkBufferMax),
    }),
  });
}
