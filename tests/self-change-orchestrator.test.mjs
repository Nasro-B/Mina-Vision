import { describe, expect, it, vi } from 'vitest';
import { createSelfChangeOrchestrator } from '../src/code/self/self-change-orchestrator.mjs';
import { assertPatchAllowed } from '../src/code/self/sealed-files.mjs';

function build(overrides = {}) {
  const calls = [];
  const trace = (name) => (...a) => { calls.push(name); return a; };
  const worktreeManager = {
    create: vi.fn(async () => { calls.push('worktree.create'); return { name: 'self/x', path: '/repo/.wt/self-x' }; }),
    purge: vi.fn(async () => { calls.push('worktree.purge'); return { purged: true }; }),
  };
  const checkpoint = {
    create: vi.fn(async ({ label }) => { calls.push(`checkpoint(${label.startsWith('avant') ? 'avant' : 'après'})`); return { id: label }; }),
  };
  const deps = {
    worktreeManager,
    assertPatchAllowed: vi.fn((paths, opts) => assertPatchAllowed(paths, { repoRoot: '/repo', ...opts })),
    planChange: vi.fn(async () => { calls.push('plan'); return { radius: 'petit' }; }),
    implementInWorktree: vi.fn(async () => { calls.push('implement'); return { changedPaths: ['src/code/a.mjs'], diffSummary: '+10 -2' }; }),
    runGate: vi.fn(async () => { calls.push('gate'); return { passed: true, unit: 'green', smoke: 'ok' }; }),
    confirm: vi.fn(async () => true),
    merge: vi.fn(async () => { calls.push('merge'); return { merged: true }; }),
    relaunch: vi.fn(async () => { calls.push('relaunch'); }),
    checkpoint,
    ...overrides,
  };
  return { deps, calls, worktreeManager, checkpoint };
}

describe('self-change-orchestrator (auto-modification T4.3)', () => {
  it('parcours complet : ordre confirmé → plan → worktree → gate → confirm → checkpoint AVANT → merge → checkpoint APRÈS → purge → relance', async () => {
    const { deps, calls } = build();
    const r = await createSelfChangeOrchestrator(deps).run({ request: 'améliore X', changedPathsPreview: ['src/code/a.mjs'] });
    expect(r).toMatchObject({ done: true });
    // ordre CRITIQUE : checkpoint(avant) AVANT merge AVANT checkpoint(après)
    const iAvant = calls.indexOf('checkpoint(avant)');
    const iMerge = calls.indexOf('merge');
    const iApres = calls.indexOf('checkpoint(après)');
    expect(iAvant).toBeGreaterThanOrEqual(0);
    expect(iAvant).toBeLessThan(iMerge);
    expect(iMerge).toBeLessThan(iApres);
    expect(calls).toContain('worktree.purge');
    expect(calls.indexOf('relaunch')).toBeGreaterThan(iApres);
  });

  it('intention refusée → stoppe AVANT tout worktree', async () => {
    const { deps, worktreeManager } = build({ confirm: vi.fn(async ({ step }) => step !== 'intent') });
    const r = await createSelfChangeOrchestrator(deps).run({ request: 'x' });
    expect(r).toMatchObject({ done: false, reason: 'intent_refused' });
    expect(worktreeManager.create).not.toHaveBeenCalled();
  });

  it('chemin SCELLÉ dans l’aperçu → rejet AVANT le worktree', async () => {
    const { deps, worktreeManager } = build();
    await expect(createSelfChangeOrchestrator(deps).run({ request: 'x', changedPathsPreview: ['src/safety/policy.mjs'] }))
      .rejects.toThrow('sealed_files');
    expect(worktreeManager.create).not.toHaveBeenCalled();
  });

  it('gate ROUGE → purge, jamais de merge', async () => {
    const { deps, calls } = build({ runGate: vi.fn(async () => ({ passed: false, unit: 'red' })) });
    const r = await createSelfChangeOrchestrator(deps).run({ request: 'x', changedPathsPreview: [] });
    expect(r).toMatchObject({ done: false, reason: 'gate_failed' });
    expect(calls).toContain('worktree.purge');
    expect(calls).not.toContain('merge');
  });

  it('merge refusé à la confirmation → purge, jamais de merge ni checkpoint', async () => {
    const { deps, calls } = build({ confirm: vi.fn(async ({ step }) => step === 'intent') });
    const r = await createSelfChangeOrchestrator(deps).run({ request: 'x', changedPathsPreview: [] });
    expect(r).toMatchObject({ done: false, reason: 'merge_refused' });
    expect(calls).not.toContain('merge');
    expect(calls).not.toContain('checkpoint(avant)');
  });

  it('chemin scellé dans les fichiers RÉELLEMENT modifiés → rejet + worktree purgé', async () => {
    const { deps, worktreeManager } = build({ implementInWorktree: vi.fn(async () => ({ changedPaths: ['src/crypto/keyring.mjs'], diffSummary: 'x' })) });
    await expect(createSelfChangeOrchestrator(deps).run({ request: 'x', changedPathsPreview: [] })).rejects.toThrow('sealed_files');
    expect(worktreeManager.purge).toHaveBeenCalled();
  });
});
