// Fenêtre d'éveil pour les ACTIONS (plan de durcissement T3.1). Cœur pur et testable.
//
// Défaut à corriger : dans `voice-orchestrator.mjs`, une fois le mot d'éveil prononcé, la session
// reste `activated` indéfiniment — TOUT énoncé suivant devient une commande exécutable. « Chaque
// phrase près du micro peut lancer une mission. » La conversation doit rester libre, mais une action
// à EFFET RÉEL (mission navigateur/bureau, envoi, exécution) ne doit partir que si « Mina » a été
// prononcé dans les N dernières secondes. On réduit ainsi la surface d'un ordre de grandeur : parler
// à côté du micro ne suffit plus, il faut adresser Mina juste avant l'action.
//
// Ce module ne connaît ni la voix ni les missions : il ne fait que dater le dernier éveil et
// répondre « une action est-elle permise maintenant ? ». Entièrement vérifiable hors application.

const DEFAULT_WINDOW_MS = 30_000; // 30 s : assez pour « Mina » puis l'ordre, trop court pour un écho fortuit.

export function createWakeWindow({ windowMs = DEFAULT_WINDOW_MS, clock = Date.now } = {}) {
  if (!Number.isFinite(windowMs) || windowMs <= 0) throw new TypeError('wake_window_ms_invalid');
  if (typeof clock !== 'function') throw new TypeError('wake_window_clock_invalid');
  let lastWakeAt = null;

  // Un éveil vient d'être entendu : on ouvre (ou rouvre) la fenêtre.
  function markWake() {
    lastWakeAt = Number(clock());
    return lastWakeAt;
  }

  function remainingMs() {
    if (lastWakeAt === null) return 0;
    const elapsed = Number(clock()) - lastWakeAt;
    return elapsed >= windowMs ? 0 : windowMs - elapsed;
  }

  // Une action à effet réel est-elle permise ? Uniquement si un éveil est encore dans la fenêtre.
  function isActionAllowed() {
    return remainingMs() > 0;
  }

  // Après une action exécutée, on FERME la fenêtre : chaque action demande son propre éveil récent,
  // un seul « Mina » ne débloque pas une rafale d'ordres. La conversation, elle, ne consomme rien.
  function consume() {
    lastWakeAt = null;
  }

  return Object.freeze({ markWake, isActionAllowed, remainingMs, consume, windowMs });
}

export const WAKE_WINDOW_DEFAULT_MS = DEFAULT_WINDOW_MS;
