const ACTIVE_STATUS = 'running';

const assertActive = (state) => {
  if (state.status !== ACTIVE_STATUS) {
    throw new Error(`Mission inactive: ${state.status}`);
  }
};

export function createMission({ goal, mode, maxActions, timeoutMs, now = Date.now() }) {
  if (!goal?.trim()) throw new Error('Objectif manquant.');
  if (!['general', 'dental'].includes(mode)) throw new Error(`Mode invalide: ${mode}`);

  return Object.freeze({
    goal: goal.trim(),
    mode,
    status: ACTIVE_STATUS,
    startedAt: now,
    maxActions,
    timeoutMs,
    actionCount: 0,
    failureCount: 0,
    lastError: null,
    stopReason: null,
    result: null,
  });
}

export function recordAction(state, now = Date.now()) {
  assertActive(state);
  const actionCount = state.actionCount + 1;
  const timedOut = now - state.startedAt >= state.timeoutMs;
  const budgetExhausted = actionCount >= state.maxActions;

  return Object.freeze({
    ...state,
    actionCount,
    failureCount: 0,
    lastError: null,
    status: timedOut || budgetExhausted ? 'stopped' : ACTIVE_STATUS,
    stopReason: timedOut ? 'mission_timeout' : budgetExhausted ? 'action_budget_exhausted' : null,
  });
}

export function recordFailure(state, reason) {
  assertActive(state);
  const failureCount = state.failureCount + 1;
  const stopped = failureCount >= 3;

  return Object.freeze({
    ...state,
    failureCount,
    lastError: String(reason),
    status: stopped ? 'stopped' : ACTIVE_STATUS,
    stopReason: stopped ? 'too_many_failures' : null,
  });
}

export function completeMission(state, result) {
  assertActive(state);
  return Object.freeze({ ...state, status: 'completed', result });
}

export function stopMission(state, reason) {
  assertActive(state);
  return Object.freeze({ ...state, status: 'stopped', stopReason: reason });
}
