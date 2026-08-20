// Réconciliateur de navigation (SPEC-MINA-BROWSER-001 §10). PUR : il tient l'état DÉSIRÉ d'une
// commande (effet attendu, deadline, budget de récupération, navigationId courant) et borne les
// transitions. Interdictions clés (§10.4) : une seule récupération (budget), aucune référence DOM
// issue d'un ancien navigationId, jamais d'action après la deadline. Il ne pilote rien lui-même ; il
// dit ce qui est permis. Module PUR, non câblé au runtime.

export const RECONCILER_STATES = Object.freeze([
  'idle', 'classified', 'authorized', 'dispatching',
  'navigating', 'acting', 'researching', 'verifying', 'completed',
  'recovering', 'failed', 'timed_out', 'cancelled', 'blocked', 'confirmation_required',
]);

const TRANSITIONS = Object.freeze({
  idle: ['classified', 'cancelled'],
  classified: ['authorized', 'blocked', 'confirmation_required', 'cancelled'],
  confirmation_required: ['authorized', 'blocked', 'cancelled'],
  authorized: ['dispatching', 'cancelled'],
  dispatching: ['navigating', 'acting', 'researching', 'cancelled'],
  navigating: ['verifying', 'recovering', 'failed', 'timed_out', 'cancelled'],
  acting: ['verifying', 'recovering', 'failed', 'timed_out', 'cancelled'],
  researching: ['verifying', 'failed', 'timed_out', 'cancelled'],
  verifying: ['completed', 'recovering', 'failed'],
  recovering: ['navigating', 'acting', 'verifying', 'failed', 'timed_out', 'cancelled'],
  // terminaux
  completed: [], failed: [], timed_out: [], cancelled: [], blocked: [],
});

export function createBrowserReconciliation({
  commandId, expectedEffect = null, deadlineMs = 30_000, maxRecoveries = 1, now = () => 0,
} = {}) {
  if (!commandId) throw new Error('browser_reconcile_command_required');
  let state = 'idle';
  let recoveryCount = 0;
  let navigationId = null;
  const startedAt = now();
  const history = [Object.freeze({ state, atMs: startedAt })];

  const isTerminal = (value) => TRANSITIONS[value].length === 0;

  return Object.freeze({
    commandId,
    expectedEffect,
    state: () => state,
    recoveryCount: () => recoveryCount,
    navigationId: () => navigationId,
    isTerminal: () => isTerminal(state),
    can: (next) => (TRANSITIONS[state] ?? []).includes(next),

    transition(next, meta = {}) {
      if (!(TRANSITIONS[state] ?? []).includes(next)) throw new Error(`browser_reconcile_invalid:${state}->${next}`);
      if (next === 'recovering') {
        // §10.3/§10.4 : une seule récupération. Au-delà, échec honnête, jamais de boucle.
        if (recoveryCount >= maxRecoveries) throw new Error('browser_recovery_budget_exhausted');
        recoveryCount += 1;
      }
      state = next;
      history.push(Object.freeze({ state, atMs: now(), ...meta }));
      return state;
    },

    // Une nouvelle navigation renouvelle le navigationId → les anciennes références DOM sont périmées.
    setNavigation(id) { navigationId = String(id); return navigationId; },
    isRefValid(refNavigationId) { return navigationId !== null && String(refNavigationId) === navigationId; },

    isExpired(atMs = now()) { return (atMs - startedAt) > deadlineMs; },
    history: () => history.map((entry) => ({ ...entry })),
  });
}
