// Refactoring multi-fichier atomique : applique un plan de patchs dans l'ordre topologique
// (dépendances d'abord), vérifie les tests si demandé, et sait tout annuler (mode atomic).

export function createRefactorWorkspace({
  patchApplier,
  dependencyGraph = null,
  fileBackup,
  testRunner = null,
  fs,
} = {}) {
  if (!patchApplier) throw new TypeError('refactor_workspace_patch_applier_required');
  if (!fileBackup) throw new TypeError('refactor_workspace_backup_required');
  if (!fs || typeof fs.rm !== 'function') throw new TypeError('refactor_workspace_fs_required');

  async function rollbackAll(appliedEntries) {
    for (const entry of [...appliedEntries].reverse()) {
      if (entry.operation === 'add') {
        await fs.rm(entry.file, { force: true }).catch(() => {});
      } else if (fileBackup.hasBackup(entry.file)) {
        await fileBackup.restore(entry.file).catch(() => {});
      }
    }
  }

  return Object.freeze({
    async execute({ plan, verifyTests = true, atomic = true } = {}) {
      if (!plan || !Array.isArray(plan.patches) || plan.patches.length === 0) {
        throw new Error('refactor_workspace_plan_required');
      }
      for (const entry of plan.patches) {
        if (typeof entry?.file !== 'string' || typeof entry?.patch !== 'string') {
          throw new Error('refactor_workspace_patch_entry_invalid');
        }
      }

      // Ordre topologique : les fichiers dont d'autres dépendent sont modifiés d'abord.
      let ordered = [...plan.patches];
      if (dependencyGraph) {
        const order = dependencyGraph.topologicalSort();
        ordered.sort((a, b) => {
          const indexA = order.indexOf(a.file);
          const indexB = order.indexOf(b.file);
          return (indexA === -1 ? order.length : indexA) - (indexB === -1 ? order.length : indexB);
        });
      }

      const results = [];
      const allApplied = [];
      for (const entry of ordered) {
        try {
          const applied = await patchApplier.apply({ patches: entry.patch, backup: true, reformat: false, lint: false });
          allApplied.push(...applied.applied);
          results.push({ file: entry.file, success: true });
        } catch (error) {
          results.push({ file: entry.file, success: false, error: error.message });
          if (atomic) {
            await rollbackAll(allApplied);
            return Object.freeze({
              success: false,
              rolledBack: true,
              reason: `refactor_atomic_rollback: ${entry.file} — ${error.message}`,
              results: Object.freeze(results.map((item) => Object.freeze(item))),
            });
          }
        }
      }

      let tests = null;
      if (verifyTests && testRunner) {
        tests = await testRunner.runAll({ bail: true }).catch((error) => ({ passed: 0, failed: 1, error: error.message }));
        if (tests.failed > 0 && atomic) {
          await rollbackAll(allApplied);
          return Object.freeze({
            success: false,
            rolledBack: true,
            reason: `refactor_tests_failed: ${tests.failed} échec(s)`,
            tests: Object.freeze(tests),
            results: Object.freeze(results.map((item) => Object.freeze(item))),
          });
        }
      }

      const failures = results.filter((item) => !item.success);
      return Object.freeze({
        success: failures.length === 0 && (tests === null || tests.failed === 0),
        rolledBack: false,
        filesChanged: allApplied.length,
        tests: tests ? Object.freeze(tests) : null,
        results: Object.freeze(results.map((item) => Object.freeze(item))),
      });
    },
  });
}
