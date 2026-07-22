function matchesDesired(state, desired) {
  return Object.entries(desired).every(([key, value]) => (
    typeof value === 'object' && value !== null
      ? JSON.stringify(state?.[key]) === JSON.stringify(value)
      : state?.[key] === value
  ));
}

export function createSmartHomeVerifier() {
  function verify({ accepted, observedState, desiredState } = {}) {
    if (!accepted) return Object.freeze({ state: 'failed', verified: false });
    const verified = matchesDesired(observedState, desiredState ?? {});
    return Object.freeze({ state: verified ? 'state_confirmed' : 'accepted_by_provider', verified, observedState });
  }

  return Object.freeze({ verify, matchesDesired });
}
