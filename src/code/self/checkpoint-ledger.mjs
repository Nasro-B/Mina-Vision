// Timeline T5.1 (SPEC agente-codage V5) : registre APPEND-ONLY des checkpoints de Mina — chaque merge self
// (et chaque point manuel/externe) y laisse une entrée { id, date, commit sha, tag mina-self/<n>, origine,
// résultat des gates, boot prouvé }. Le registre désigne la « dernière version saine » = le dernier
// checkpoint dont le boot est prouvé — cible du rollback automatique (T5.3). Le `store` est INJECTÉ
// (SQLite au runtime, en mémoire pour les tests) ; par défaut un store mémoire pour l'usage direct. Le
// registre n'ÉCRASE jamais une entrée (append-only) : l'histoire de Mina est intangible.

const ORIGINS = new Set(['self-change', 'manual', 'external']);
const SHA = /^[0-9a-f]{7,40}$/iu;

function memoryStore() {
  const rows = [];
  return { append: (r) => { rows.push(r); }, all: () => rows.slice() };
}

export function createCheckpointLedger({ store = memoryStore(), now = () => Date.now() } = {}) {
  if (typeof store.append !== 'function' || typeof store.all !== 'function') {
    throw new TypeError('checkpoint_ledger_store_required');
  }

  return Object.freeze({
    record({ commitSha, tag = null, origin, gates = null, bootProven = false } = {}) {
      if (!SHA.test(String(commitSha ?? ''))) throw new TypeError('checkpoint_commit_sha_invalid');
      if (!ORIGINS.has(origin)) throw new TypeError('checkpoint_origin_invalid');
      const n = store.all().length + 1;
      const record = Object.freeze({
        id: `cp-${n}`,
        date: new Date(now()).toISOString(),
        commitSha: String(commitSha),
        tag: tag ?? `mina-self/${n}`,
        origin,
        gates: gates ?? null,
        bootProven: Boolean(bootProven),
      });
      store.append(record);
      return record;
    },

    list() {
      return Object.freeze(store.all());
    },

    // Dernière version SAINE = le dernier checkpoint avec boot prouvé (cible du rollback auto).
    lastHealthy() {
      const rows = store.all();
      for (let i = rows.length - 1; i >= 0; i -= 1) {
        if (rows[i].bootProven) return rows[i];
      }
      return null;
    },

    byTag(tag) {
      return store.all().find((r) => r.tag === tag) ?? null;
    },
  });
}
