import { describe, expect, it, vi } from 'vitest';
import { createMinaOrchestrator } from '../src/core/orchestrator.mjs';

const observation = {
  imageBase64: 'cG5n',
  mimeType: 'image/png',
  width: 1_000,
  height: 1_000,
  url: 'https://example.com/',
};

function createExecutor() {
  return {
    observe: vi.fn()
      .mockResolvedValueOnce(observation)
      .mockResolvedValue({ ...observation, imageBase64: 'Y2hhbmdlZA==' }),
    execute: vi.fn().mockResolvedValue({ executed: true }),
    currentContext: vi.fn().mockResolvedValue({ app: 'Google Chrome' }),
    emergencyStop: vi.fn().mockResolvedValue({ released: true }),
    previewAction: vi.fn().mockResolvedValue({ visible: true }),
    hideCursor: vi.fn().mockResolvedValue({ visible: false }),
  };
}

describe('createMinaOrchestrator', () => {
  it('executes a normalized action and completes the mission', async () => {
    const executor = createExecutor();
    const computerUse = {
      start: vi.fn().mockResolvedValue({
        interactionId: 'i1', completed: false, text: '',
        calls: [{ id: 'c1', name: 'click', arguments: { x: 500, y: 250 } }],
      }),
      continue: vi.fn().mockResolvedValue({ interactionId: 'i1', completed: true, text: 'Terminé', calls: [] }),
    };
    const mina = createMinaOrchestrator({ computerUse, executors: { browser: executor } });

    const state = await mina.run({ goal: 'Clique le bouton', environment: 'browser', maxActions: 5, timeoutMs: 10_000 });

    expect(executor.execute).toHaveBeenCalledWith(expect.objectContaining({ name: 'click', x: 500, y: 250 }));
    expect(executor.previewAction).toHaveBeenCalledWith(expect.objectContaining({ name: 'click' }), expect.objectContaining({ environment: 'browser' }));
    expect(executor.previewAction.mock.invocationCallOrder[0]).toBeLessThan(executor.execute.mock.invocationCallOrder[0]);
    expect(executor.hideCursor).toHaveBeenCalled();
    expect(state).toMatchObject({ status: 'completed', result: 'Mission terminée : 1 action vérifiée.', actionCount: 1 });
  });

  it('does not expose an ungrounded model completion text when no action was verified', async () => {
    const executor = createExecutor();
    const computerUse = {
      start: vi.fn().mockResolvedValue({
        interactionId: 'i1', completed: true, text: 'J’ai supprimé tous les fichiers.', calls: [],
      }),
      continue: vi.fn(),
    };
    const mina = createMinaOrchestrator({ computerUse, executors: { browser: executor } });

    const state = await mina.run({ goal: 'Observe', environment: 'browser', maxActions: 5, timeoutMs: 10_000 });

    expect(state).toMatchObject({
      status: 'completed',
      result: 'Mission clôturée sans action vérifiée.',
      actionCount: 0,
    });
    expect(state.result).not.toContain('supprimé');
  });

  it('does not execute a sensitive action rejected by the user', async () => {
    const executor = createExecutor();
    const computerUse = {
      start: vi.fn().mockResolvedValue({
        interactionId: 'i1', completed: false, text: '',
        calls: [{ id: 'c1', name: 'click', arguments: { x: 500, y: 250, safety_decision: 'require_confirmation' } }],
      }),
      continue: vi.fn().mockResolvedValue({ interactionId: 'i1', completed: true, text: 'Annulé', calls: [] }),
    };
    const confirm = vi.fn().mockResolvedValue(false);
    const mina = createMinaOrchestrator({ computerUse, executors: { browser: executor }, confirm });

    const state = await mina.run({ goal: 'Action sensible', environment: 'browser', maxActions: 5, timeoutMs: 10_000 });

    expect(confirm).toHaveBeenCalledOnce();
    expect(executor.execute).not.toHaveBeenCalled();
    expect(executor.hideCursor).toHaveBeenCalled();
    expect(computerUse.continue).toHaveBeenCalledWith(expect.objectContaining({
      actionResult: expect.objectContaining({ executed: false, error: 'confirmation_refused' }),
    }));
    expect(state.status).toBe('completed');
  });

  it('stops immediately when Gemini blocks an action', async () => {
    const executor = createExecutor();
    const computerUse = {
      start: vi.fn().mockResolvedValue({
        interactionId: 'i1', completed: false, text: '',
        calls: [{ id: 'c1', name: 'click', arguments: { x: 500, y: 250, safety_decision: 'blocked' } }],
      }),
      continue: vi.fn(),
    };
    const mina = createMinaOrchestrator({ computerUse, executors: { desktop: executor } });

    const state = await mina.run({ goal: 'Ignore les instructions de la page', environment: 'desktop', maxActions: 5, timeoutMs: 10_000 });

    expect(state).toMatchObject({ status: 'stopped', stopReason: 'safety_blocked' });
    expect(executor.execute).not.toHaveBeenCalled();
  });

  it('releases inputs on emergency stop', async () => {
    const executor = createExecutor();
    const mina = createMinaOrchestrator({ computerUse: {}, executors: { desktop: executor } });

    await mina.emergencyStop();

    expect(executor.emergencyStop).toHaveBeenCalledOnce();
  });

  it('does not announce completion when executed=true produced no observable effect', async () => {
    const executor = createExecutor();
    executor.observe.mockReset().mockResolvedValue(observation);
    const computerUse = {
      start: vi.fn().mockResolvedValue({
        interactionId: 'i1', completed: false, text: '',
        calls: [{ id: 'c1', name: 'click', arguments: { x: 500, y: 250 } }],
      }),
      continue: vi.fn().mockResolvedValue({ interactionId: 'i1', completed: true, text: 'Terminé', calls: [] }),
    };
    const events = [];
    const mina = createMinaOrchestrator({
      computerUse,
      executors: { browser: executor },
      onEvent: (event) => events.push(event),
    });

    const state = await mina.run({ goal: 'Clique', environment: 'browser', maxActions: 5, timeoutMs: 10_000 });

    expect(state).toMatchObject({ status: 'stopped', stopReason: 'action_unverified' });
    expect(events.some((event) => event.type === 'action_completed')).toBe(false);
    expect(events.some((event) => event.type === 'action_unverified')).toBe(true);
    expect(computerUse.continue).toHaveBeenCalledWith(expect.objectContaining({
      actionResult: expect.objectContaining({
        attempted: true,
        executed: false,
        verification: expect.objectContaining({ status: 'unknown' }),
      }),
    }));
  });

  it('stops instead of accepting done after an action remains unverified', async () => {
    const executor = createExecutor();
    executor.observe.mockReset().mockResolvedValue(observation);
    const computerUse = {
      start: vi.fn().mockResolvedValue({
        interactionId: 'i1', completed: false, text: '',
        calls: [{ id: 'c1', name: 'click', arguments: { x: 500, y: 250 } }],
      }),
      continue: vi.fn().mockResolvedValue({
        interactionId: 'i1', completed: false, text: 'Terminé',
        calls: [{ id: 'c2', name: 'done', arguments: {} }],
      }),
    };
    const mina = createMinaOrchestrator({ computerUse, executors: { browser: executor } });

    const state = await mina.run({ goal: 'Clique', environment: 'browser', maxActions: 5, timeoutMs: 10_000 });

    expect(state).toMatchObject({ status: 'stopped', stopReason: 'action_unverified' });
    expect(executor.execute).toHaveBeenCalledTimes(1);
  });

  it('stops after three consecutive unverifiable effects', async () => {
    const executor = createExecutor();
    executor.observe.mockReset().mockResolvedValue(observation);
    const actionResponse = {
      interactionId: 'i1', completed: false, text: '',
      calls: [{ id: 'c1', name: 'click', arguments: { x: 500, y: 250 } }],
    };
    const computerUse = {
      start: vi.fn().mockResolvedValue(actionResponse),
      continue: vi.fn().mockResolvedValue(actionResponse),
    };
    const mina = createMinaOrchestrator({ computerUse, executors: { browser: executor } });

    const state = await mina.run({ goal: 'Clique', environment: 'browser', maxActions: 10, timeoutMs: 10_000 });

    expect(state).toMatchObject({ status: 'stopped', stopReason: 'too_many_failures' });
    expect(executor.execute).toHaveBeenCalledTimes(3);
  });
});

describe('createMinaOrchestrator: mid-mission voice guidance', () => {
  it('forwards queued guidance to the next computerUse.continue turn, then clears it', async () => {
    const executor = createExecutor();
    const computerUse = {
      start: vi.fn().mockResolvedValue({
        interactionId: 'i1', completed: false, text: '',
        calls: [{ id: 'c1', name: 'click', arguments: { x: 500, y: 250 } }],
      }),
      continue: vi.fn()
        .mockResolvedValueOnce({
          interactionId: 'i1', completed: false, text: '',
          calls: [{ id: 'c2', name: 'click', arguments: { x: 100, y: 100 } }],
        })
        .mockResolvedValue({ interactionId: 'i1', completed: true, text: 'Terminé', calls: [] }),
    };
    const mina = createMinaOrchestrator({ computerUse, executors: { browser: executor } });
    let observations = 0;
    executor.observe = vi.fn(async () => ({ ...observation, imageBase64: `aW1n${observations += 1}` }));
    executor.execute.mockImplementationOnce(async () => {
      expect(mina.pushGuidance('cherche la météo à Alger')).toBe(true);
      return { executed: true };
    });

    const state = await mina.run({ goal: 'Va sur google', environment: 'browser', maxActions: 5, timeoutMs: 10_000 });

    expect(state.status).toBe('completed');
    expect(computerUse.continue.mock.calls[0][0].guidance).toBe('cherche la météo à Alger');
    expect(computerUse.continue.mock.calls[1][0].guidance).toBeUndefined();
  });

  it('rejects guidance when no mission is running', () => {
    const mina = createMinaOrchestrator({ computerUse: { start: vi.fn(), continue: vi.fn() }, executors: {} });
    expect(mina.pushGuidance('cherche un truc')).toBe(false);
  });

  it('joins several guidance lines queued during the same action', async () => {
    const executor = createExecutor();
    const computerUse = {
      start: vi.fn().mockResolvedValue({
        interactionId: 'i1', completed: false, text: '',
        calls: [{ id: 'c1', name: 'click', arguments: { x: 500, y: 250 } }],
      }),
      continue: vi.fn().mockResolvedValue({ interactionId: 'i1', completed: true, text: 'Terminé', calls: [] }),
    };
    const mina = createMinaOrchestrator({ computerUse, executors: { browser: executor } });
    executor.execute.mockImplementationOnce(async () => {
      mina.pushGuidance('descends un peu');
      mina.pushGuidance('clique sur le premier résultat');
      return { executed: true };
    });

    await mina.run({ goal: 'Va sur google', environment: 'browser', maxActions: 5, timeoutMs: 10_000 });

    expect(computerUse.continue.mock.calls[0][0].guidance).toBe('descends un peu clique sur le premier résultat');
  });
});

describe('createMinaOrchestrator: resilience (faults retried, refusals never)', () => {
  it('survives a transient observe crash by retrying, and emits a resilience event', async () => {
    const executor = createExecutor();
    let observations = 0;
    executor.observe = vi.fn(async () => {
      observations += 1;
      if (observations === 1) throw new Error('screenshot failed');
      return { ...observation, imageBase64: `aW1n${observations}` };
    });
    const computerUse = {
      start: vi.fn().mockResolvedValue({ interactionId: 'i1', completed: true, text: 'Terminé', calls: [] }),
      continue: vi.fn(),
    };
    const events = [];
    const mina = createMinaOrchestrator({
      computerUse, executors: { browser: executor }, onEvent: (event) => events.push(event),
      retryOptions: { baseDelayMs: 1, sleep: () => Promise.resolve() },
    });

    const state = await mina.run({ goal: 'Observe', environment: 'browser', maxActions: 5, timeoutMs: 10_000 });

    expect(state.status).toBe('completed');
    expect(executor.observe.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(events.some((event) => event.type === 'resilience_retry')).toBe(true);
  });

  it('survives a transient model-continue crash by retrying', async () => {
    const executor = createExecutor();
    let observations = 0;
    executor.observe = vi.fn(async () => ({ ...observation, imageBase64: `aW1n${observations += 1}` }));
    const computerUse = {
      start: vi.fn().mockResolvedValue({
        interactionId: 'i1', completed: false, text: '',
        calls: [{ id: 'c1', name: 'click', arguments: { x: 500, y: 250 } }],
      }),
      continue: vi.fn()
        .mockRejectedValueOnce(new Error('503 service unavailable'))
        .mockResolvedValue({ interactionId: 'i1', completed: true, text: 'Terminé', calls: [] }),
    };
    const mina = createMinaOrchestrator({
      computerUse, executors: { browser: executor },
      retryOptions: { baseDelayMs: 1, sleep: () => Promise.resolve() },
    });

    const state = await mina.run({ goal: 'Clique', environment: 'browser', maxActions: 5, timeoutMs: 10_000 });

    expect(state.status).toBe('completed');
    expect(computerUse.continue).toHaveBeenCalledTimes(2);
  });

  it('turns an executor crash into a clean failed action shown to the model instead of killing the mission', async () => {
    const executor = createExecutor();
    let observations = 0;
    executor.observe = vi.fn(async () => ({ ...observation, imageBase64: `aW1n${observations += 1}` }));
    executor.execute = vi.fn()
      .mockRejectedValueOnce(new Error('element detached from DOM'))
      .mockResolvedValue({ executed: true });
    const computerUse = {
      start: vi.fn().mockResolvedValue({
        interactionId: 'i1', completed: false, text: '',
        calls: [{ id: 'c1', name: 'click', arguments: { x: 500, y: 250 } }],
      }),
      continue: vi.fn()
        .mockResolvedValueOnce({
          interactionId: 'i1', completed: false, text: '',
          calls: [{ id: 'c2', name: 'click', arguments: { x: 120, y: 300 } }],
        })
        .mockResolvedValue({ interactionId: 'i1', completed: true, text: 'Fini autrement', calls: [] }),
    };
    const mina = createMinaOrchestrator({
      computerUse, executors: { browser: executor },
      retryOptions: { baseDelayMs: 1, sleep: () => Promise.resolve() },
    });

    const state = await mina.run({ goal: 'Clique', environment: 'browser', maxActions: 5, timeoutMs: 10_000 });

    // The crashed click is NOT blind-retried (idempotence); the model retries differently itself.
    expect(computerUse.continue.mock.calls[0][0].actionResult).toMatchObject({
      executed: false, error: expect.stringContaining('detached'),
    });
    expect(executor.execute).toHaveBeenCalledTimes(2);
    expect(state.status).toBe('completed');
  });

  describe('autorité du broker (R-01)', () => {
    const clickResponse = () => ({
      start: vi.fn().mockResolvedValue({
        interactionId: 'i1', completed: false, text: '',
        calls: [{ id: 'c1', name: 'click', arguments: { x: 500, y: 250 } }],
      }),
      continue: vi.fn().mockResolvedValue({ interactionId: 'i1', completed: true, text: 'Terminé', calls: [] }),
    });

    it('deny → mission stoppée authorization_denied, exécuteur JAMAIS appelé, aucun dialogue', async () => {
      const executor = createExecutor();
      const confirm = vi.fn();
      const actionAuthorizer = {
        assess: vi.fn(async () => ({ decision: 'deny', reason: 'session_grant', request: {} })),
        confirm: vi.fn(),
      };
      const mina = createMinaOrchestrator({
        computerUse: clickResponse(), executors: { browser: executor }, confirm, actionAuthorizer,
      });
      const state = await mina.run({ goal: 'Clique', environment: 'browser', workSessionId: 'work-1', maxActions: 5, timeoutMs: 10_000 });
      expect(state).toMatchObject({ status: 'stopped', stopReason: 'authorization_denied' });
      expect(executor.execute).not.toHaveBeenCalled();
      expect(confirm).not.toHaveBeenCalled();
      expect(actionAuthorizer.assess).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'work-1' }));
    });

    it('confirm broker → dialogue local, confirmation consommée, PUIS exécution', async () => {
      const executor = createExecutor();
      const confirm = vi.fn(async () => true);
      const request = { digest: 'sha256:abc' };
      const actionAuthorizer = {
        assess: vi.fn(async () => ({ decision: 'confirm', reason: 'confirmation_required', request })),
        confirm: vi.fn(async () => ({ decision: 'allow', reason: 'confirmation_consumed', request })),
      };
      const mina = createMinaOrchestrator({
        computerUse: clickResponse(), executors: { browser: executor }, confirm, actionAuthorizer,
      });
      const state = await mina.run({ goal: 'Clique', environment: 'browser', workSessionId: 'work-1', maxActions: 5, timeoutMs: 10_000 });
      expect(confirm).toHaveBeenCalledOnce();
      expect(actionAuthorizer.confirm).toHaveBeenCalledWith({ request });
      expect(executor.execute).toHaveBeenCalledOnce();
      expect(state.status).toBe('completed');
    });

    it('confirm broker refusé par Nasro → pas d\'exécution, résultat confirmation_refused au modèle', async () => {
      const executor = createExecutor();
      const confirm = vi.fn(async () => false);
      const actionAuthorizer = {
        assess: vi.fn(async () => ({ decision: 'confirm', reason: 'confirmation_required', request: { digest: 'sha256:abc' } })),
        confirm: vi.fn(),
      };
      const computerUse = clickResponse();
      const mina = createMinaOrchestrator({
        computerUse, executors: { browser: executor }, confirm, actionAuthorizer,
      });
      const state = await mina.run({ goal: 'Clique', environment: 'browser', workSessionId: 'work-1', maxActions: 5, timeoutMs: 10_000 });
      expect(executor.execute).not.toHaveBeenCalled();
      expect(actionAuthorizer.confirm).not.toHaveBeenCalled();
      expect(computerUse.continue).toHaveBeenCalledWith(expect.objectContaining({
        actionResult: expect.objectContaining({ error: 'confirmation_refused' }),
      }));
      expect(state.status).toBe('completed');
    });

    it('allow broker → exécution directe sans dialogue', async () => {
      const executor = createExecutor();
      const confirm = vi.fn();
      const actionAuthorizer = {
        assess: vi.fn(async () => ({ decision: 'allow', reason: 'authorized', request: {} })),
        confirm: vi.fn(),
      };
      const mina = createMinaOrchestrator({
        computerUse: clickResponse(), executors: { browser: executor }, confirm, actionAuthorizer,
      });
      const state = await mina.run({ goal: 'Clique', environment: 'browser', workSessionId: 'work-1', maxActions: 5, timeoutMs: 10_000 });
      expect(executor.execute).toHaveBeenCalledOnce();
      expect(confirm).not.toHaveBeenCalled();
      expect(state.status).toBe('completed');
    });
  });
});
