import { describe, expect, it, vi } from 'vitest';
import { createSkillRouter } from '../src/skills/skill-router.mjs';
import { createSkillSessionManager } from '../src/skills/skill-session.mjs';

const research = Object.freeze({
  slug: 'research-summary', name: 'research-summary', version: '1.0.0', digest: 'sha256:research',
  triggers: ['résume cette recherche', 'synthèse sourcée'], capabilities: ['research.web'],
  channels: ['local', 'telegram'], budgets: { maxDurationMs: 30_000, maxCostMicros: 1_000, maxTokens: 4_096 },
});
const file = Object.freeze({
  slug: 'file-analysis', name: 'file-analysis', version: '1.0.0', digest: 'sha256:file',
  triggers: ['analyse ce fichier'], capabilities: ['files.read'], channels: ['local'],
  budgets: { maxDurationMs: 30_000, maxCostMicros: 500, maxTokens: 2_048 },
});

function harness(entries = [research, file], overrides = {}) {
  const registry = {
    list: vi.fn(() => entries),
    get: vi.fn((name) => entries.find((entry) => entry.name === name) ?? null),
  };
  const loader = {
    load: vi.fn(async (slug) => ({
      ...entries.find((entry) => entry.slug === slug), body: '# Instructions',
      references: { 'references/method.md': 'preuve' }, scripts: [],
    })),
  };
  const budgetGuard = {
    snapshot: vi.fn(async () => ({ remainingMicros: 10_000 })),
  };
  const sessions = createSkillSessionManager({ clock: () => 123, ids: () => 'skill-session-1' });
  const router = createSkillRouter({ registry, loader, budgetGuard, sessions, threshold: 0.6, ...overrides });
  return { router, registry, loader, budgetGuard, sessions };
}

const base = Object.freeze({
  workSessionId: 'work-1', sessionId: 'session-1', channel: 'local',
  availableCapabilities: ['research.web', 'files.read'],
  requestedBudget: { maxDurationMs: 10_000, maxCostMicros: 100, maxTokens: 1_000 },
});

describe('skill routing and sessions', () => {
  it('activates an explicit skill and records a digest-bound session', async () => {
    const { router, loader, sessions } = harness();
    const result = await router.activate({ ...base, name: 'research-summary' });
    expect(result).toMatchObject({ decision: 'activated', skill: { name: 'research-summary' } });
    expect(result.session).toMatchObject({
      id: 'skill-session-1', workSessionId: 'work-1', version: '1.0.0', digest: 'sha256:research',
      capabilities: ['research.web'], referencesLoaded: ['references/method.md'], status: 'active',
    });
    expect(loader.load).toHaveBeenCalledWith('research-summary');
    expect(sessions.list('work-1')).toHaveLength(1);
  });

  it('auto-routes deterministically and asks local clarification on a tie', async () => {
    const { router } = harness();
    await expect(router.activate({ ...base, query: 'Peux-tu résume cette recherche ?' }))
      .resolves.toMatchObject({ decision: 'activated', skill: { name: 'research-summary' } });

    const twin = { ...research, slug: 'research-twin', name: 'research-twin' };
    const ambiguous = harness([research, twin]).router;
    await expect(ambiguous.activate({ ...base, query: 'résume cette recherche' })).resolves.toEqual({
      decision: 'clarify', reason: 'skill_route_ambiguous', candidates: ['research-summary', 'research-twin'],
    });
  });

  it('fails closed for unavailable, incompatible channel or missing capability', async () => {
    const { router, loader } = harness();
    await expect(router.activate({ ...base, name: 'absent' })).rejects.toThrow('skill_unavailable:absent');
    await expect(router.activate({ ...base, name: 'file-analysis', channel: 'telegram' }))
      .rejects.toThrow('skill_channel_incompatible:file-analysis:telegram');
    await expect(router.activate({ ...base, name: 'file-analysis', availableCapabilities: [] }))
      .rejects.toThrow('skill_capability_unavailable:files.read');
    await expect(router.activate({ ...base, name: 'research-summary', channel: 'sms' }))
      .rejects.toThrow('skill_channel_forbidden:sms');
    expect(loader.load).not.toHaveBeenCalled();
  });

  it('denies skill and global budget excess before loading instructions', async () => {
    const { router, loader } = harness();
    await expect(router.activate({
      ...base, name: 'file-analysis', requestedBudget: { maxDurationMs: 31_000, maxCostMicros: 100, maxTokens: 1_000 },
    })).rejects.toThrow('skill_budget_exceeded:maxDurationMs');
    expect(loader.load).not.toHaveBeenCalled();

    const global = harness([research], {
      budgetGuard: { snapshot: vi.fn(async () => ({ remainingMicros: 50 })) },
    });
    await expect(global.router.activate({ ...base, name: 'research-summary' })).rejects.toThrow('skill_budget_exceeded:global_cost');
    expect(global.loader.load).not.toHaveBeenCalled();
  });

  it('closes every active skill session when its work session ends', async () => {
    const { router, sessions } = harness();
    const activated = await router.activate({ ...base, name: 'research-summary' });
    const closed = sessions.closeForWorkSession('work-1', 'work_session_end');
    expect(closed).toHaveLength(1);
    expect(closed[0]).toMatchObject({ id: activated.session.id, status: 'closed', reason: 'work_session_end', endedAt: 123 });
    expect(sessions.list('work-1')).toEqual([]);
  });
});
