// Salience + récence pour le CLASSEMENT du rappel mémoire — jamais pour supprimer : un souvenir
// ancien et jamais consulté garde un plancher qui le laisse remonter si sa pertinence est forte
// (la spec mémoire interdit toute expiration automatique ; ceci ne touche que l'ordre).

const DAY_MS = 86_400_000;
// Demi-vie de récence ~30 jours, plancher 0,4 : un fait d'il y a un an pèse encore 40 % de son
// score lexical/vectoriel — le decay ne peut structurellement pas faire disparaître un résultat.
const RECENCY_HALF_LIFE_MS = 30 * DAY_MS;
const RECENCY_FLOOR = 0.4;
// La salience (accès répétés) BONIFIE sans jamais pénaliser : multiplicateur ≥ 1, saturé, et sa
// part décroît si le souvenir n'a plus été touché depuis longtemps.
const SALIENCE_HALF_LIFE_MS = 7 * DAY_MS;
const SALIENCE_MAX_BOOST = 0.5;

export function recencyWeight(createdAt, now) {
  if (!Number.isFinite(createdAt) || !Number.isFinite(now) || createdAt >= now) return 1;
  const decay = 2 ** (-(now - createdAt) / RECENCY_HALF_LIFE_MS);
  return RECENCY_FLOOR + (1 - RECENCY_FLOOR) * decay;
}

export function salienceWeight({ hits = 0, lastHitAt = 0 } = {}, now = Date.now()) {
  if (!Number.isFinite(hits) || hits <= 0) return 1;
  const saturation = Math.min(1, Math.log1p(hits) / Math.log1p(10));
  const freshness = Number.isFinite(lastHitAt) && lastHitAt > 0 && lastHitAt < now
    ? 2 ** (-(now - lastHitAt) / SALIENCE_HALF_LIFE_MS)
    : 1;
  return 1 + SALIENCE_MAX_BOOST * saturation * freshness;
}

export function rankScore({ base, createdAt, now, salience }) {
  if (!Number.isFinite(base) || base <= 0) return 0;
  return base * recencyWeight(createdAt, now) * salienceWeight(salience ?? {}, now);
}

// Compteur d'accès en mémoire de processus : léger, sans migration de schéma. Sa perte au
// redémarrage est un decay acceptable — la récence, elle, vient de createdAt qui est persistant.
export function createSalienceTracker({ now = Date.now, maxEntries = 5_000 } = {}) {
  const entries = new Map();
  return Object.freeze({
    touch(id) {
      const key = String(id ?? '');
      if (!key) return;
      const current = entries.get(key) ?? { hits: 0, lastHitAt: 0 };
      entries.delete(key); // ré-insertion en fin = éviction des plus anciens d'abord
      entries.set(key, { hits: current.hits + 1, lastHitAt: now() });
      if (entries.size > maxEntries) entries.delete(entries.keys().next().value);
    },
    get(id) {
      return entries.get(String(id ?? '')) ?? { hits: 0, lastHitAt: 0 };
    },
    size: () => entries.size,
  });
}
