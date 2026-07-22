const TRANSITIONS = Object.freeze({
  listening: new Set(['transcribing', 'idle']),
  transcribing: new Set(['listening', 'thinking', 'idle']),
  thinking: new Set(['speaking', 'idle']),
  speaking: new Set(['listening', 'idle']),
});

export function createVoiceSession({
  id,
  clock = Date.now,
  timeoutMs = 120_000,
  onEvent = () => {},
  onInterrupt = () => {},
} = {}) {
  if (typeof id !== 'string' || !id || !Number.isFinite(timeoutMs) || timeoutMs < 1) {
    throw new TypeError('voice_session_config_invalid');
  }
  let state = 'idle';
  let startedAt = null;
  let ended = false;
  let endReason = null;
  let controller = new AbortController();
  controller.abort();
  const now = () => Number(typeof clock === 'function' ? clock() : clock.now());

  function snapshot() {
    return Object.freeze({ id, state, startedAt, ended, endReason });
  }

  function emit(type, details = {}) {
    onEvent(Object.freeze({ type, session: snapshot(), ...details }));
  }

  function replaceController({ aborted = false } = {}) {
    controller.abort();
    controller = new AbortController();
    if (aborted) controller.abort();
  }

  function finish(reason) {
    if (ended) return snapshot();
    const from = state;
    replaceController({ aborted: true });
    state = 'idle';
    ended = true;
    endReason = reason;
    if (from !== 'idle') emit('voice_state', { from, to: 'idle', reason });
    emit('session_end', { reason });
    return snapshot();
  }

  function assertActive() {
    if (state === 'idle' || ended) throw new Error('voice_session_not_active');
    if (now() - startedAt > timeoutMs) {
      finish('timeout');
      throw new Error('voice_session_timeout');
    }
  }

  function start() {
    if (state !== 'idle' || startedAt !== null) throw new Error('voice_session_already_started');
    startedAt = now();
    state = 'listening';
    replaceController();
    emit('session_start');
    return snapshot();
  }

  function transition(next, details = {}) {
    assertActive();
    if (!TRANSITIONS[state]?.has(next)) throw new Error(`voice_transition_invalid:${state}:${next}`);
    if (next === 'idle') return finish(details.reason ?? 'completed');
    const from = state;
    replaceController();
    state = next;
    emit('voice_state', { from, to: next, ...details });
    return snapshot();
  }

  function stop(reason = 'user_stop') {
    if (ended || state === 'idle') return snapshot();
    return finish(reason);
  }

  function bargeIn() {
    assertActive();
    if (state !== 'speaking') throw new Error(`voice_barge_in_invalid:${state}`);
    const from = state;
    replaceController();
    state = 'listening';
    onInterrupt(Object.freeze({ sessionId: id, reason: 'barge_in', from }));
    emit('voice_state', { from, to: 'listening', reason: 'barge_in' });
    return snapshot();
  }

  return Object.freeze({ start, transition, stop, bargeIn, status: snapshot, signal: () => controller.signal });
}
