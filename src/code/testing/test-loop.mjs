// Boucle TDD : rouge → vert → refactor. Le cœur de l'agent de code.
// 1. Suite initiale VERTE exigée (sinon abort — on ne construit jamais sur du rouge).
// 2. Le test généré doit ÉCHOUER d'abord (un test qui passe d'emblée ne teste rien).
// 3. Code minimal jusqu'au vert, borné par maxIterations → GIVING_UP.
// 4. Refactor optionnel, suite toujours verte ensuite.

export const TddStatus = Object.freeze({
  DONE: 'done',
  ABORTED_INITIAL_RED: 'aborted_initial_red',
  TEST_NEVER_RED: 'test_never_red',
  GIVING_UP: 'giving_up',
});

export function createTestLoop({ testRunner, patchApplier, generateTest, generateFix, generateRefactor = null } = {}) {
  if (!testRunner || typeof testRunner.runAll !== 'function') throw new TypeError('test_loop_runner_required');
  if (!patchApplier || typeof patchApplier.apply !== 'function') throw new TypeError('test_loop_applier_required');
  if (typeof generateTest !== 'function' || typeof generateFix !== 'function') {
    throw new TypeError('test_loop_generators_required');
  }

  return Object.freeze({
    async execute({ task, maxIterations = 5, onIteration = () => {}, refactor = false } = {}) {
      if (typeof task !== 'string' || task.trim().length === 0) throw new Error('test_loop_task_required');
      const bounded = Math.min(Math.max(1, Number(maxIterations) || 5), 20);
      const history = [];
      const note = (phase, result) => {
        const entry = Object.freeze({ phase, passed: result?.passed ?? 0, failed: result?.failed ?? 0 });
        history.push(entry);
        onIteration(entry);
      };

      // 1. État initial : la suite doit être verte.
      const initial = await testRunner.runAll({ bail: false });
      note('état_initial', initial);
      if (initial.failed > 0 || initial.crashed) {
        return Object.freeze({
          status: TddStatus.ABORTED_INITIAL_RED,
          reason: `suite initiale rouge (${initial.failed} échec(s)) — corriger avant tout cycle TDD`,
          iterations: 0,
          history: Object.freeze(history),
        });
      }

      // 2. Écrire le test : il doit échouer.
      const testPatch = await generateTest({ task });
      await patchApplier.apply({ patches: testPatch, reformat: false, lint: false });
      const redRun = await testRunner.runAll({ bail: false });
      note('test_écrit', redRun);
      if (redRun.failed === 0) {
        return Object.freeze({
          status: TddStatus.TEST_NEVER_RED,
          reason: 'le test généré passe déjà — il ne teste rien, à ajuster',
          iterations: 0,
          history: Object.freeze(history),
        });
      }

      // 3. Code minimal jusqu'au vert.
      let lastRun = redRun;
      for (let iteration = 1; iteration <= bounded; iteration += 1) {
        const fixPatch = await generateFix({
          task,
          failure: Object.freeze({ failed: lastRun.failed, failures: lastRun.failures, output: lastRun.output ?? '' }),
          attempt: iteration,
        });
        await patchApplier.apply({ patches: fixPatch, reformat: false, lint: false });
        lastRun = await testRunner.runAll({ bail: false });
        note(`itération_${iteration}`, lastRun);
        if (lastRun.failed === 0 && !lastRun.crashed) {
          // 4. Refactor optionnel : la suite doit RESTER verte.
          if (refactor && typeof generateRefactor === 'function') {
            const refactorPatch = await generateRefactor({ task });
            if (refactorPatch) {
              await patchApplier.apply({ patches: refactorPatch, reformat: false, lint: false });
              const afterRefactor = await testRunner.runAll({ bail: false });
              note('refactor', afterRefactor);
              if (afterRefactor.failed > 0) {
                return Object.freeze({
                  status: TddStatus.GIVING_UP,
                  reason: 'le refactor a cassé la suite',
                  iterations: iteration,
                  history: Object.freeze(history),
                });
              }
            }
          }
          return Object.freeze({
            status: TddStatus.DONE,
            iterations: iteration,
            testsAdded: Math.max(0, lastRun.total - initial.total),
            finalRun: Object.freeze({ passed: lastRun.passed, failed: lastRun.failed, total: lastRun.total }),
            history: Object.freeze(history),
          });
        }
      }

      return Object.freeze({
        status: TddStatus.GIVING_UP,
        reason: `toujours rouge après ${bounded} itération(s) — intervention humaine requise`,
        iterations: bounded,
        history: Object.freeze(history),
      });
    },
  });
}
