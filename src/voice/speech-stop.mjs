// Mot d'arrêt de parole : « stop », « chut », « tais-toi », « silence », « arrête » — détecté
// LOCALEMENT dans la transcription du propriétaire, coupe la voix de Mina immédiatement, sans
// dépendre du barge-in serveur ni de la fenêtre anti-écho du renderer (qui avale les
// interruptions précoces — cause réelle du « stop qui ne marche pas », 2026-07-22).

const STOP_WORD = /\b(?:stop|chut|silence|tais[- ]?toi|arr[êe]te(?:[- ]?toi)?)\b/iu;
// Un ordre d'arrêt est un énoncé COURT. Dans une phrase longue, le mot fait partie d'une
// commande (« arrête la musique quand la chanson se termine ») — on ne coupe pas la parole
// sur ces phrases-là, l'intention passe par la voie normale des intents.
const MAX_WORDS = 4;

export function detectStopCommand(fragment) {
  const text = String(fragment ?? '')
    .toLowerCase()
    .replace(/[.,!?;:…]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  if (!text) return false;
  if (text.split(' ').length > MAX_WORDS) return false;
  return STOP_WORD.test(text);
}

// Porte de suppression : après un stop, les chunks audio restants du MÊME tour modèle continuent
// d'arriver du serveur — ils sont jetés jusqu'à la fin de tour, sinon Mina « reprend » sa phrase
// coupée avec les morceaux bufferisés.
export function createSpeechGate() {
  let suppressing = false;
  return Object.freeze({
    noteStop() {
      suppressing = true;
    },
    noteTurnComplete() {
      suppressing = false;
    },
    shouldSuppress: () => suppressing,
  });
}

// ---- Mode PAUSE (demande Nasro 2026-07-22) ----------------------------------------------------
// « Mets-toi en pause » → silence TOTAL : Mina n'exécute plus rien, ne parle plus, ignore toutes
// les voix entendues — jusqu'à ce que son NOM soit prononcé (« Mina », « reprends Mina »).

const PAUSE_WORD = /\b(?:pause|pose)\b/iu;
const PAUSE_MAX_WORDS = 5;
// Reprise : le NOM suffit (« Mina », « reprends Mina », « Mina reviens », « salut Mina »).
// Borne de longueur : une conversation ambiante qui MENTIONNE Mina dans une longue phrase ne
// doit pas la réveiller — un appel adressé est court.
const RESUME_WORD = /\bmina\b/iu;
const RESUME_MAX_WORDS = 6;

const normalize = (fragment) => String(fragment ?? '')
  .toLowerCase()
  .replace(/[.,!?;:…]/gu, ' ')
  .replace(/\s+/gu, ' ')
  .trim();

export function detectPauseCommand(fragment) {
  const text = normalize(fragment);
  if (!text || text.split(' ').length > PAUSE_MAX_WORDS) return false;
  return PAUSE_WORD.test(text);
}

export function detectResumeCommand(fragment) {
  const text = normalize(fragment);
  if (!text || text.split(' ').length > RESUME_MAX_WORDS) return false;
  return RESUME_WORD.test(text);
}

export function createPauseGate() {
  let paused = false;
  return Object.freeze({
    pause() {
      paused = true;
    },
    resume() {
      paused = false;
    },
    isPaused: () => paused,
  });
}
