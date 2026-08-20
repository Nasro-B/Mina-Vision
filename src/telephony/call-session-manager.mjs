// Machine d'état d'une session d'appel (SPEC-MINA-COMMS-001 §8.1). PURE : elle ne décroche rien, ne
// parle à personne, n'expose aucun outil — elle borne les transitions autorisées et interdit les
// sauts illégaux. Si le média disparaît (§7) ou l'IA tombe, l'appel bascule vers un état terminal
// d'échec depuis n'importe quel état actif ; jamais un appel silencieux qui « continue » pour de faux.
// Module PUR, non câblé au runtime.

export const CALL_STATES = Object.freeze([
  'detected', 'screening', 'eligible', 'answering', 'disclosure', 'consent',
  'taking_message', 'readback', 'confirmed', 'completed', 'task_pending', 'task_synced',
  // terminaux d'échec / sortie :
  'ineligible', 'refused', 'missed', 'media_failed', 'ai_failed', 'caller_hung_up', 'timed_out', 'task_sync_pending',
]);

const TRANSITIONS = Object.freeze({
  detected: ['screening', 'missed'],
  screening: ['eligible', 'ineligible', 'refused', 'missed', 'caller_hung_up'],
  eligible: ['answering', 'missed', 'ineligible'],
  answering: ['disclosure', 'media_failed', 'ai_failed', 'caller_hung_up'],
  disclosure: ['consent', 'refused', 'caller_hung_up', 'media_failed', 'ai_failed'],
  consent: ['taking_message', 'refused', 'caller_hung_up', 'media_failed', 'ai_failed'],
  taking_message: ['readback', 'caller_hung_up', 'media_failed', 'ai_failed', 'timed_out'],
  readback: ['confirmed', 'taking_message', 'caller_hung_up', 'media_failed'], // correction → retour collecte
  confirmed: ['completed'],
  completed: ['task_pending', 'task_synced'],
  task_pending: ['task_synced', 'task_sync_pending'],
  // terminaux : aucune sortie
  task_synced: [], ineligible: [], refused: [], missed: [], media_failed: [], ai_failed: [], caller_hung_up: [], timed_out: [], task_sync_pending: [],
});

// Échecs pouvant survenir depuis n'importe quel état actif (média/IA/raccroché).
const HARD_FAILURES = new Set(['media_failed', 'ai_failed', 'caller_hung_up', 'timed_out']);

export function createCallSession({ callId, deviceId, now = () => 0 } = {}) {
  if (!callId || !deviceId) throw new Error('call_session_ids_required');
  let state = 'detected';
  const history = [Object.freeze({ state, atMs: now() })];

  const isTerminal = (value) => TRANSITIONS[value].length === 0;

  return Object.freeze({
    callId, deviceId,
    state: () => state,
    history: () => history.map((entry) => ({ ...entry })),
    isTerminal: () => isTerminal(state),
    can: (next) => (TRANSITIONS[state] ?? []).includes(next),

    transition(next, meta = {}) {
      if (!(TRANSITIONS[state] ?? []).includes(next)) throw new Error(`call_transition_invalid:${state}->${next}`);
      state = next;
      history.push(Object.freeze({ state, atMs: now(), ...meta }));
      return state;
    },

    // Panne dure : depuis un état actif, force le terminal correspondant (§7 : le média disparaît → stop).
    fail(reason) {
      if (!HARD_FAILURES.has(reason)) throw new Error(`call_failure_invalid:${reason}`);
      if (isTerminal(state)) return state; // déjà terminé
      state = reason;
      history.push(Object.freeze({ state, atMs: now(), forced: true }));
      return state;
    },
  });
}
