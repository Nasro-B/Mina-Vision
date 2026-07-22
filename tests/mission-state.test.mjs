import { describe, expect, it } from 'vitest';
import {
  completeMission,
  createMission,
  recordAction,
  recordFailure,
  stopMission,
} from '../src/core/mission-state.mjs';

describe('mission state', () => {
  it('stops on the third consecutive failure', () => {
    let state = createMission({
      goal: 'test',
      mode: 'general',
      maxActions: 40,
      timeoutMs: 1_000,
      now: 0,
    });

    state = recordFailure(recordFailure(recordFailure(state, 'x'), 'x'), 'x');

    expect(state.status).toBe('stopped');
    expect(state.stopReason).toBe('too_many_failures');
  });

  it('resets consecutive failures after a successful action', () => {
    let state = createMission({ goal: 'test', mode: 'general', maxActions: 3, timeoutMs: 1_000, now: 0 });
    state = recordFailure(state, 'x');
    state = recordAction(state, 100);

    expect(state.failureCount).toBe(0);
    expect(state.actionCount).toBe(1);
  });

  it('stops when the action budget is exhausted', () => {
    let state = createMission({ goal: 'test', mode: 'general', maxActions: 1, timeoutMs: 1_000, now: 0 });
    state = recordAction(state, 100);

    expect(state.status).toBe('stopped');
    expect(state.stopReason).toBe('action_budget_exhausted');
  });

  it('stops when the mission timeout is reached', () => {
    let state = createMission({ goal: 'test', mode: 'general', maxActions: 3, timeoutMs: 1_000, now: 0 });
    state = recordAction(state, 1_000);

    expect(state.status).toBe('stopped');
    expect(state.stopReason).toBe('mission_timeout');
  });

  it('supports explicit completion and stop', () => {
    const state = createMission({ goal: 'test', mode: 'dental', maxActions: 2, timeoutMs: 1_000, now: 0 });
    expect(completeMission(state, { ok: true }).status).toBe('completed');
    expect(stopMission(state, 'user').stopReason).toBe('user');
  });
});
