import { detectStopPhrase, detectWakePhrase } from '../voice/wake-phrases.mjs';

const ENVIRONMENTS = new Set(['browser', 'desktop', 'mobile']);
const GROUNDING_LABELS = Object.freeze({
  verified: 'Vérifié',
  inference: 'Inférence',
  uncertain: 'Incertain',
  not_found: 'Incertain',
  stale: 'Incertain',
  unsupported: 'Action non vérifiée',
});

export function formatGroundingLabel(status) {
  return GROUNDING_LABELS[status] ?? 'Action non vérifiée';
}

export function applyEnvironmentSelection(environment, radios) {
  const requested = String(environment ?? '');
  if (!ENVIRONMENTS.has(requested)) throw new Error('Environnement Mina invalide.');
  for (const radio of radios) radio.checked = radio.value === requested;
  return requested;
}

export function validateMissionRequest(request) {
  const goal = String(request?.goal ?? '').trim();
  const environment = String(request?.environment ?? 'browser');
  if (!goal || goal.length > 4_000) throw new Error('Une instruction de 1 à 4000 caractères est requise.');
  if (!ENVIRONMENTS.has(environment)) throw new Error('Environnement Mina invalide.');
  return Object.freeze({ goal, environment, ...(request?.memoryRequired === true ? { memoryRequired: true } : {}) });
}

export function createVoiceCommandRouter({
  onWake = () => {},
  onCommand = () => {},
  onStop = () => {},
} = {}) {
  let awaitingCommand = false;

  return Object.freeze({
    push: (transcript) => {
      const text = String(transcript ?? '').trim();
      if (!text) return { type: 'ignored' };
      if (detectStopPhrase(text)) {
        awaitingCommand = false;
        onStop();
        return { type: 'stop' };
      }

      const wake = detectWakePhrase(text);
      if (wake.activated) {
        onWake(wake.phrase);
        if (wake.remainder) {
          awaitingCommand = false;
          onCommand(wake.remainder);
          return { type: 'command', command: wake.remainder };
        }
        awaitingCommand = true;
        return { type: 'wake' };
      }

      if (!awaitingCommand) return { type: 'ignored' };
      awaitingCommand = false;
      onCommand(text);
      return { type: 'command', command: text };
    },
  });
}

// Planification de la lecture des chunks vocaux. Cause des micro-coupures (« perturbations »)
// constat 2026-07-22 : marge de démarrage de 20 ms seulement — le moindre retard réseau/IPC d'un
// chunk créait un trou audible, répété à chaque hoquet. Coussin de démarrage de salve : 150 ms
// (imperceptible en conversation, absorbe la gigue) ; chunk en retard en cours de salve : recalage
// à +60 ms — UN petit gap au lieu d'une rafale de clics.
export const VOICE_START_LEAD_SECONDS = 0.15;
export const VOICE_LATE_CHUNK_LEAD_SECONDS = 0.06;

export function computeVoiceStartTime({ currentTime, queuedUntil = 0, queueEmpty = true } = {}) {
  const lead = queueEmpty ? VOICE_START_LEAD_SECONDS : VOICE_LATE_CHUNK_LEAD_SECONDS;
  return Math.max(Number(currentTime) + lead, Number(queuedUntil) || 0);
}

export function createVoiceIpcController({ voiceOrchestrator } = {}) {
  if (!voiceOrchestrator?.start || !voiceOrchestrator?.pushAudio || !voiceOrchestrator?.stop) {
    throw new TypeError('voice_ipc_orchestrator_required');
  }
  return Object.freeze({
    start: (options) => voiceOrchestrator.start(options),
    pushAudio: (request) => voiceOrchestrator.pushAudio(request),
    stop: (sessionId) => voiceOrchestrator.stop(sessionId, 'user_stop'),
    emergencyStop: (sessionId) => voiceOrchestrator.stop(sessionId, 'emergency_stop'),
  });
}
