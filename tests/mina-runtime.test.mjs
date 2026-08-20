import { describe, expect, it, vi } from 'vitest';
import { createMinaRuntime } from '../src/core/mina-runtime.mjs';
import { createClaimLedger } from '../src/grounding/claim-ledger.mjs';
import { createSessionManager } from '../src/sessions/session-manager.mjs';
import { createSessionStore } from '../src/sessions/session-store.mjs';

function createHarness({ evidenceProvider, cancellers } = {}) {
  let id = 0;
  const store = createSessionStore();
  const sessionManager = createSessionManager({
    store,
    clock: () => Date.parse('2026-07-15T00:00:00.000Z'),
    ids: (kind) => `${kind}-${++id}`,
  });
  const claimLedger = createClaimLedger({
    clock: () => Date.parse('2026-07-15T00:00:00.000Z'),
    ids: () => `claim-${++id}`,
  });
  const runtime = createMinaRuntime({ sessionManager, claimLedger, evidenceProvider, cancellers });
  return { runtime, store, claimLedger };
}

describe('Mina runtime composition root', () => {
  it('starts and becomes ready before accepting work', async () => {
    const { runtime, store } = createHarness();

    await expect(runtime.runWork({ channel: 'local', identityId: 'owner', goal: 'Trop tôt', run: async () => {} }))
      .rejects.toThrow('runtime_not_ready');
    await runtime.start();

    expect(store.list().slice(0, 2).map((event) => event.type)).toEqual(['runtime_start', 'runtime_ready']);
    expect(runtime.getSessionState()).toMatchObject({ runtimeStatus: 'ready', activeWorkSessions: [] });
  });

  it('wraps a mission in a work session on success and error', async () => {
    const { runtime, store } = createHarness();
    await runtime.start();

    await expect(runtime.runWork({
      channel: 'local', identityId: 'owner', goal: 'Succès', run: async () => 'ok',
    })).resolves.toBe('ok');
    await expect(runtime.runWork({
      channel: 'voice', identityId: 'owner', goal: 'Erreur', run: async () => { throw new Error('boom'); },
    })).rejects.toThrow('boom');

    const endings = store.list().filter((event) => event.type === 'work_session_end');
    expect(endings.map((event) => event.payload.reason)).toEqual(['completed', 'error']);
    expect(runtime.getSessionState().activeWorkSessions).toEqual([]);
  });

  it('passes recalled evidence as a distinct runner argument and never mutates the goal', async () => {
    const evidence = [{ sourceId: 'memory-1', extract: 'Mardi à 14 h' }];
    const evidenceProvider = vi.fn(async () => evidence);
    const { runtime } = createHarness({ evidenceProvider });
    await runtime.start();
    const run = vi.fn(async ({ evidence: received }) => received);

    await expect(runtime.runWork({
      channel: 'local', identityId: 'owner', goal: 'Quand ?', memoryRequired: true, run,
    })).resolves.toEqual(evidence);
    expect(evidenceProvider).toHaveBeenCalledWith({ channel: 'local', identityId: 'owner', goal: 'Quand ?', memoryRequired: true });
    // R-01 : le runner reçoit AUSSI le workSessionId — c'est lui qui borne le grant du broker.
    expect(run).toHaveBeenCalledWith({ evidence, workSessionId: expect.any(String) });
  });

  it('records a claim id for completed mission result text', async () => {
    const { runtime, claimLedger } = createHarness();
    await runtime.start();

    const result = await runtime.runWork({
      channel: 'local',
      identityId: 'owner',
      goal: 'Mission avec actions vérifiées',
      run: async () => Object.freeze({
        status: 'completed',
        result: 'Mission terminée : 1 action vérifiée.',
        actionCount: 1,
      }),
    });

    expect(result).toMatchObject({
      status: 'completed',
      result: 'Mission terminée : 1 action vérifiée.',
      resultClaimId: expect.any(String),
    });
    expect(claimLedger.get(result.resultClaimId)).toMatchObject({
      sessionId: expect.any(String),
      text: 'Mission terminée : 1 action vérifiée.',
      claimType: 'mission_result',
      status: 'verified',
    });
  });

  it('ends active work on emergency stop and ends the runtime on shutdown', async () => {
    const { runtime, store } = createHarness();
    await runtime.start();
    let release;
    const pending = new Promise((resolve) => { release = resolve; });
    const work = runtime.runWork({
      channel: 'local', identityId: 'owner', goal: 'Longue mission', run: async () => pending,
    });
    await Promise.resolve();

    await runtime.emergencyStop();
    release('late');
    await work;
    await runtime.shutdown({ timeoutMs: 2_000 });

    expect(store.list().some((event) => (
      event.type === 'work_session_end' && event.payload.reason === 'emergency_stop'
    ))).toBe(true);
    expect(store.list().at(-1)).toMatchObject({ type: 'runtime_end', payload: { status: 'ended' } });
  });

  it('cancels skill sessions and sandbox jobs during the same emergency stop', async () => {
    const cancellers = [vi.fn(async () => ({ canceled: true })), vi.fn(async () => ({ canceled: true }))];
    const { runtime } = createHarness({ cancellers });
    await runtime.start();

    await expect(runtime.emergencyStop()).resolves.toEqual({ stopped: true });
    expect(cancellers[0]).toHaveBeenCalledOnce();
    expect(cancellers[1]).toHaveBeenCalledOnce();
  });

  it('exposes immutable read-only projections of claims and grounding status', async () => {
    const { runtime, claimLedger } = createHarness();
    await runtime.start();
    claimLedger.add({
      sessionId: 'work-1', text: 'Fait incertain', kind: 'fact', sourceRefs: ['evidence-1'], status: 'uncertain',
    });

    expect(runtime.getClaims()).toHaveLength(1);
    expect(Object.isFrozen(runtime.getClaims())).toBe(true);
    expect(runtime.getGroundingStatus()).toEqual({
      total: 1,
      verified: 0,
      inference: 0,
      uncertain: 1,
      not_found: 0,
      unsupported: 0,
      stale: 0,
    });
  });
});
