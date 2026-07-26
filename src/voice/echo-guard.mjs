// Garde anti-écho de la propre voix de Mina (cause réelle 2026-07-25 : le micro capte les
// haut-parleurs ; « Je cherche sur le web » revient comme énoncé UTILISATEUR, la couche dialogue
// y voit verbe (« cherche ») + surface (« web ») et lance une mission navigateur fantôme qui
// échoue aussitôt — « la mission a échoué » sans aucune demande).
//
// Principe : on mémorise ce que Mina vient de DIRE (fenêtre glissante), et un énoncé entrant dont
// les mots significatifs sont massivement contenus dans cette parole récente est jeté comme écho.
// Un vrai ordre pendant qu'elle parle (« ouvre youtube ») utilise d'autres mots → jamais bloqué.
// Les mots de contrôle (« stop », « pause ») sont routés AVANT cette garde par l'appelant.

const strip = (value) => String(value ?? '')
  .toLocaleLowerCase('fr-FR')
  .normalize('NFD')
  .replace(/\p{M}/gu, '')
  .replace(/[^a-z0-9\s]/gu, ' ');

// Seuls les mots ≥ 3 caractères comptent : les mots-outils (le, la, je, tu, de…) sont partout et
// gonfleraient artificiellement le recouvrement d'une phrase courte légitime.
const significantTokens = (value) => strip(value).split(/\s+/u).filter((token) => token.length >= 3);

export function createEchoGuard({
  windowMs = 15_000,
  minTokens = 3,
  threshold = 0.7,
  maxEntries = 40,
  now = () => Date.now(),
} = {}) {
  /** @type {Array<{ tokens: Set<string>, at: number }>} */
  let entries = [];

  const purge = () => {
    const cutoff = now() - windowMs;
    entries = entries.filter((entry) => entry.at >= cutoff).slice(-maxEntries);
  };

  return Object.freeze({
    /** Enregistre un texte que Mina vient de prononcer (fragment ou tour complet). */
    record(text) {
      const tokens = significantTokens(text);
      if (tokens.length === 0) return;
      entries.push({ tokens: new Set(tokens), at: now() });
      purge();
    },

    /**
     * Vrai si l'énoncé est un écho de la parole récente de Mina : au moins `minTokens` mots
     * significatifs, dont ≥ `threshold` sont contenus dans ce qu'elle vient de dire.
     */
    isEcho(utterance) {
      purge();
      if (entries.length === 0) return false;
      const tokens = significantTokens(utterance);
      if (tokens.length < minTokens) return false;
      const spoken = new Set();
      for (const entry of entries) for (const token of entry.tokens) spoken.add(token);
      const matched = tokens.filter((token) => spoken.has(token)).length;
      return matched / tokens.length >= threshold;
    },

    /** Vide la fenêtre (tests / arrêt de session). */
    reset() {
      entries = [];
    },
  });
}
