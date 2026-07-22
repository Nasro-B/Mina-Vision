import { describe, expect, it } from 'vitest';
import { createTestLoop, TddStatus } from '../../src/code/testing/test-loop.mjs';

// Fabrique une boucle TDD avec une suite scriptée : chaque appel runAll consomme le prochain
// résultat de la file — on scénarise ainsi rouge/vert déterministe.
function buildLoop(runs, { generateRefactor, applyLog = [] } = {}) {
  const queue = [...runs];
  const testRunner = {
    runAll: async () => {
      if (queue.length === 0) throw new Error('scénario épuisé');
      return queue.shift();
    },
  };
  const patchApplier = { apply: async ({ patches }) => { applyLog.push(patches); return { applied: [] }; } };
  const loop = createTestLoop({
    testRunner,
    patchApplier,
    generateTest: async () => 'PATCH_TEST',
    generateFix: async ({ attempt }) => `PATCH_FIX_${attempt}`,
    generateRefactor,
  });
  return { loop, applyLog };
}

const green = (total = 10) => ({ passed: total, failed: 0, total, crashed: false, failures: [] });
const red = (failed = 1, total = 11) => ({ passed: total - failed, failed, total, crashed: false, failures: ['tests/x.test.mjs'] });

describe('test-loop — cycle TDD', () => {
  it('exige runner, applier, générateurs et tâche', async () => {
    expect(() => createTestLoop({})).toThrow(/runner_required/u);
    const { loop } = buildLoop([green()]);
    await expect(loop.execute({})).rejects.toThrow(/task_required/u);
  });

  it('suite initiale rouge → ABORTED_INITIAL_RED sans écrire le moindre patch', async () => {
    const applyLog = [];
    const { loop } = buildLoop([red()], { applyLog });
    const result = await loop.execute({ task: 'ajouter validation' });
    expect(result.status).toBe(TddStatus.ABORTED_INITIAL_RED);
    expect(result.reason).toContain('suite initiale rouge');
    expect(applyLog).toEqual([]);
  });

  it('test qui passe d\'emblée → TEST_NEVER_RED (le test ne teste rien)', async () => {
    const { loop } = buildLoop([green(), green(11)]);
    const result = await loop.execute({ task: 'ajouter validation' });
    expect(result.status).toBe(TddStatus.TEST_NEVER_RED);
  });

  it('cycle nominal : vert initial → rouge après test → vert après fix → DONE', async () => {
    const applyLog = [];
    const iterations = [];
    const { loop } = buildLoop([green(10), red(1, 11), green(11)], { applyLog });
    const result = await loop.execute({ task: 'ajouter validation', onIteration: (entry) => iterations.push(entry.phase) });
    expect(result.status).toBe(TddStatus.DONE);
    expect(result.iterations).toBe(1);
    expect(result.testsAdded).toBe(1);
    expect(applyLog).toEqual(['PATCH_TEST', 'PATCH_FIX_1']);
    expect(iterations).toEqual(['état_initial', 'test_écrit', 'itération_1']);
  });

  it('plusieurs itérations de fix avant le vert', async () => {
    const { loop } = buildLoop([green(10), red(1, 11), red(1, 11), red(1, 11), green(11)]);
    const result = await loop.execute({ task: 'tâche coriace', maxIterations: 5 });
    expect(result.status).toBe(TddStatus.DONE);
    expect(result.iterations).toBe(3);
  });

  it('toujours rouge après maxIterations → GIVING_UP avec historique complet', async () => {
    const { loop } = buildLoop([green(10), red(1, 11), red(1, 11), red(1, 11)]);
    const result = await loop.execute({ task: 'impossible', maxIterations: 2 });
    expect(result.status).toBe(TddStatus.GIVING_UP);
    expect(result.reason).toContain('2 itération');
    expect(result.history.length).toBe(4);
  });

  it('le générateur de fix reçoit l\'échec courant et le numéro de tentative', async () => {
    const received = [];
    const queue = [green(10), red(2, 12), red(1, 12), green(12)];
    const loop = createTestLoop({
      testRunner: { runAll: async () => queue.shift() },
      patchApplier: { apply: async () => ({}) },
      generateTest: async () => 'T',
      generateFix: async ({ failure, attempt }) => { received.push({ failed: failure.failed, attempt }); return 'F'; },
    });
    await loop.execute({ task: 'x' });
    expect(received).toEqual([{ failed: 2, attempt: 1 }, { failed: 1, attempt: 2 }]);
  });

  it('refactor optionnel : suite reste verte → DONE, suite cassée → GIVING_UP', async () => {
    const ok = buildLoop([green(10), red(1, 11), green(11), green(11)], { generateRefactor: async () => 'PATCH_REFACTOR' });
    const done = await ok.loop.execute({ task: 'x', refactor: true });
    expect(done.status).toBe(TddStatus.DONE);
    expect(ok.applyLog).toContain('PATCH_REFACTOR');

    const broken = buildLoop([green(10), red(1, 11), green(11), red(1, 11)], { generateRefactor: async () => 'PATCH_REFACTOR' });
    const failed = await broken.loop.execute({ task: 'x', refactor: true });
    expect(failed.status).toBe(TddStatus.GIVING_UP);
    expect(failed.reason).toContain('refactor');
  });

  it('borne maxIterations à 20 même si on demande plus', async () => {
    const runs = [green(10), red(1, 11), ...Array(25).fill(red(1, 11))];
    const { loop } = buildLoop(runs);
    const result = await loop.execute({ task: 'x', maxIterations: 100 });
    expect(result.status).toBe(TddStatus.GIVING_UP);
    expect(result.iterations).toBe(20);
  });
});
