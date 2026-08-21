// Auto-modification T4.3 (SPEC agente-codage V4) : le flux COMPLET, chaque étape tracée, jamais
// auto-initié. Ordre : (1) demande explicite de Nasro → intention reformulée et CONFIRMÉE ; (1b) garde
// scellée sur l'aperçu des chemins (AVANT le worktree) ; (2) plan ; (3) worktree isolé + implémentation
// TDD ; (3b) garde scellée sur les fichiers RÉELLEMENT modifiés ; (4) gate complet DANS le worktree
// (unitaires + smoke boot) — rouge → abandon, jamais de merge ; (5) proposition (diff + gates) à Nasro ;
// (6) confirmation → checkpoint AVANT → merge → checkpoint APRÈS → relance. Toutes les briques (worktree,
// gate, checkpoint, merge, relance) sont INJECTÉES → testable sans git/app. Le worktree est TOUJOURS purgé
// (succès, abandon ou erreur).

export function createSelfChangeOrchestrator({
  worktreeManager, assertPatchAllowed, planChange, implementInWorktree, runGate,
  confirm, checkpoint, merge, relaunch = async () => {}, emit = () => {},
} = {}) {
  for (const [name, fn] of Object.entries({ worktreeManager, assertPatchAllowed, planChange, implementInWorktree, runGate, confirm, merge })) {
    if (!fn || (typeof fn !== 'function' && typeof fn?.create !== 'function')) throw new TypeError(`self_change_orchestrator_${name}_required`);
  }
  if (typeof checkpoint?.create !== 'function') throw new TypeError('self_change_orchestrator_checkpoint_required');

  return Object.freeze({
    async run({ request, changedPathsPreview = [] } = {}) {
      if (!request) throw new TypeError('self_change_request_required');

      // (1) Ordre explicite : intention reformulée et confirmée AVANT tout. Jamais auto-initié.
      emit('self_order', { request });
      if ((await confirm({ step: 'intent', request, reason: `Tu me demandes : « ${request} ». Je commence ?` })) !== true) {
        return Object.freeze({ done: false, reason: 'intent_refused' });
      }

      // (1b) Garde scellée sur l'aperçu — un chemin scellé annoncé stoppe AVANT même le worktree.
      assertPatchAllowed(changedPathsPreview);

      // (2) Plan sur son propre repo.
      const plan = await planChange({ request });
      emit('self_plan', { plan });

      // (3) Worktree isolé + implémentation TDD.
      const worktree = await worktreeManager.create({ request });
      try {
        const impl = await implementInWorktree({ worktree, plan });

        // (3b) Garde scellée sur les fichiers RÉELLEMENT modifiés (après implémentation).
        assertPatchAllowed(impl?.changedPaths ?? [], { repoRoot: worktree.path });

        // (4) Gate complet DANS le worktree : unitaires + smoke. Rouge → abandon, jamais de merge.
        const gate = await runGate({ worktree });
        if (!gate?.passed) {
          emit('self_gate_failed', { gate });
          await worktreeManager.purge();
          return Object.freeze({ done: false, reason: 'gate_failed', gate });
        }

        // (5) Proposition à Nasro (diff + stats + gates).
        emit('self_proposal', { diff: impl?.diffSummary ?? null, gate });

        // (6) Confirmation locale.
        if ((await confirm({ step: 'merge', request, diff: impl?.diffSummary ?? null, gate, reason: 'Fusionner ce changement ?' })) !== true) {
          await worktreeManager.purge();
          return Object.freeze({ done: false, reason: 'merge_refused' });
        }

        // checkpoint AVANT → merge → checkpoint APRÈS (ordre prouvé pour permettre le rollback).
        const before = await checkpoint.create({ label: `avant self: ${request}` });
        const merged = await merge({ worktree });
        const after = await checkpoint.create({ label: `après self: ${request}` });
        await worktreeManager.purge();

        // (7) Relance de l'app sur la nouvelle version.
        await relaunch();
        emit('self_merged', { before, after });
        return Object.freeze({ done: true, before, after, merged });
      } catch (error) {
        // Le worktree est TOUJOURS purgé, même sur erreur (jamais de worktree self orphelin).
        await worktreeManager.purge().catch(() => {});
        throw error;
      }
    },
  });
}
