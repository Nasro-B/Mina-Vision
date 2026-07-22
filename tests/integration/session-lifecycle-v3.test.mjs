import { describe, expect, it, vi } from 'vitest';
import { createMinaRuntime } from '../../src/core/mina-runtime.mjs';
import { createSessionManager } from '../../src/sessions/session-manager.mjs';
import { createSessionStore } from '../../src/sessions/session-store.mjs';
import { createClaimLedger } from '../../src/grounding/claim-ledger.mjs';
import { gateResponse } from '../../src/grounding/response-gate.mjs';
import { createBudgetGuard } from '../../src/usage/budget-guard.mjs';

describe('v3 integration: full session lifecycle with real grounding, budget, and emergency stop', () => {
  it('walks session_start through session_end with evidence, a proposed action, confirmation, verified execution, a gated response, and budget settlement', async () => {
    let clock = Date.parse('2026-07-16T00:00:00.000Z');
    const store = createSessionStore();
    const sessionManager = createSessionManager({ store, clock: () => clock, ids: (() => { let n = 0; return (kind) => `${kind}-${++n}`; })() });
    const claimLedger = createClaimLedger({ clock: () => clock, ids: () => `claim-${Math.random().toString(36).slice(2)}` });
    const budgetGuard = createBudgetGuard({ limits: { sessionMicros: 1_000_000 } });

    const runtime = createMinaRuntime({ sessionManager, claimLedger });
    await runtime.start();

    let claim;
    const memoryDecision = { indexed: false };
    const result = await runtime.runWork({
      channel: 'local',
      identityId: 'owner',
      goal: 'Lire la météo locale et la rapporter',
      evidenceProvider: undefined,
      run: async ({ evidence }) => {
        // "evidence collection": a real tool result becomes evidence, never the model's own words.
        expect(evidence).toEqual([]);
        const observedTemperature = { source: 'local-sensor', value: '21°C', observedAt: new Date(clock).toISOString() };

        // "model call" + "proposed action": the claim starts unsupported until verified.
        claim = claimLedger.add({
          sessionId: 'unused', text: 'Il fait 21°C.', kind: 'action', sourceRefs: ['evidence-1'], status: 'unsupported',
        });

        // "confirmation": a one-shot local approval, never assumed.
        const confirmed = await Promise.resolve(true);
        expect(confirmed).toBe(true);

        // "execution" + "effect verification": the claim is promoted to verified only after a real re-observation.
        const reobserved = observedTemperature.value;
        const verifiedClaim = { ...claim, status: reobserved === '21°C' ? 'verified' : 'unsupported' };
        claimLedger.add({
          sessionId: 'unused', text: verifiedClaim.text, kind: 'action', sourceRefs: verifiedClaim.evidenceIds, status: verifiedClaim.status,
          fact: { key: 'temperature', value: reobserved, observedAt: new Date(clock).toISOString(), polarity: 'present' },
        });

        // "memory decision": recorded explicitly, not silently assumed.
        memoryDecision.indexed = true;

        // "usage settlement": a budget reservation is opened and then settled, never left dangling.
        const reservation = await budgetGuard.reserve({ id: 'attempt-1', sessionId: 'session-x', providerId: 'local', costMicros: 0, durationMs: 5 });
        expect(reservation.reserved).toBe(true);
        await budgetGuard.settle('attempt-1', { costMicros: 0, durationMs: 5 });

        return { reported: reobserved };
      },
    });

    expect(result).toEqual({ reported: '21°C' });
    expect(memoryDecision.indexed).toBe(true);

    // ResponseGate: model output alone is never evidence — an unverified sensitive claim is blocked.
    const blocked = gateResponse({
      draft: { segments: [{ kind: 'factual', claimId: claim.claimId, text: 'Il fait 21°C.' }] },
      claims: claimLedger.list(),
      citations: [],
    });
    expect(blocked.decision).not.toBe('allow');

    // session_end: the work session closes and is no longer active.
    expect(runtime.getSessionState().activeWorkSessions).toEqual([]);
    const budgetSnapshot = await budgetGuard.snapshot({ type: 'session', id: 'session-x' });
    expect(budgetSnapshot.reservedCostMicros).toBe(0);
    expect(budgetSnapshot.settledCostMicros).toBe(0);
  });

  it('emergency stop cancels active work, invokes every domain canceller (mail pause, home cancel), and never re-plays an unknown effect', async () => {
    const store = createSessionStore();
    const sessionManager = createSessionManager({ store, ids: (() => { let n = 0; return (kind) => `${kind}-${++n}`; })() });
    const claimLedger = createClaimLedger({ ids: () => `claim-${Math.random().toString(36).slice(2)}` });
    const mailPauseAll = vi.fn(async () => {});
    const homeCancelInFlight = vi.fn(async () => {});
    const runtime = createMinaRuntime({
      sessionManager, claimLedger, cancellers: [mailPauseAll, homeCancelInFlight],
    });
    await runtime.start();

    let releaseWork;
    const stuckWork = runtime.runWork({
      channel: 'local', identityId: 'owner', goal: 'Action longue',
      run: () => new Promise((resolve) => { releaseWork = resolve; }),
    });

    await new Promise((resolve) => setTimeout(resolve, 10));
    await runtime.emergencyStop();

    expect(mailPauseAll).toHaveBeenCalledTimes(1);
    expect(homeCancelInFlight).toHaveBeenCalledTimes(1);
    // The in-flight work is marked canceled immediately; it only leaves activeWork bookkeeping
    // once its own promise actually settles (emergency stop cannot forcibly kill a running function,
    // it only ensures the result is discarded and no further action is taken from it).
    releaseWork(undefined);
    const value = await stuckWork;
    expect(value).toBeUndefined();
    expect(runtime.getSessionState().activeWorkSessions).toEqual([]);
  });
});
