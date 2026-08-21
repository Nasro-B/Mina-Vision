// Timeline T5.2 (SPEC agente-codage V5) : « reviens à la version d'hier / d'avant ». Liste lisible des
// checkpoints → choix → confirmation locale → on VÉRIFIE d'abord que la cible BOOTE (checkout du tag dans
// un worktree + smoke) AVANT de basculer l'arbre vivant — on ne se rend jamais sur une version cassée. Puis
// bascule : `git reset --hard <tag>` UNIQUEMENT si l'arbre est propre, sinon stash de sécurité d'abord
// (les changements ne sont jamais perdus). La garde de branche protège les branches interdites. Le
// rollback ne DÉTRUIT RIEN : la version quittée reste un checkpoint restaurable. Injectable → testable.

export function createRollbackService({ ledger, runGit, confirm, verifyTargetBoots, relaunch = async () => {}, branchGuard = null } = {}) {
  if (typeof ledger?.byTag !== 'function' || typeof runGit !== 'function' || typeof confirm !== 'function' || typeof verifyTargetBoots !== 'function') {
    throw new TypeError('rollback_service_dependencies_required');
  }

  return Object.freeze({
    // Liste lisible (comme une liste de déploiements) — date, origine, boot prouvé, sha court.
    listVersions() {
      return Object.freeze((ledger.list?.() ?? []).map((cp) => Object.freeze({
        tag: cp.tag, date: cp.date, origin: cp.origin, bootProven: cp.bootProven, sha: String(cp.commitSha).slice(0, 7),
      })));
    },

    async rollbackTo(tag) {
      const cp = ledger.byTag(tag);
      if (!cp) return Object.freeze({ rolled: false, reason: 'checkpoint_inconnu' });

      if (branchGuard && (await branchGuard.allowsReset?.()) === false) {
        return Object.freeze({ rolled: false, reason: 'branche_protegee' });
      }
      if ((await confirm({ reason: `Revenir à ${tag} du ${cp.date} (origine ${cp.origin}) ?`, action: { name: 'self.rollback', tag } })) !== true) {
        return Object.freeze({ rolled: false, reason: 'refused' });
      }

      // On ne bascule QUE si la cible boote réellement (worktree + smoke).
      const verify = await verifyTargetBoots(tag);
      if (!verify?.passed) {
        return Object.freeze({ rolled: false, reason: 'cible_boot_casse', verify });
      }

      // Bascule : stash de sécurité si l'arbre est sale (jamais de perte), puis reset --hard sur le tag.
      const status = await runGit(['status', '--porcelain']);
      const dirty = String(status?.stdout ?? '').trim() !== '';
      if (dirty) await runGit(['stash', 'push', '-u', '-m', `avant-rollback-${tag}`]);
      await runGit(['reset', '--hard', tag]);

      await relaunch();
      return Object.freeze({ rolled: true, tag, stashed: dirty, verify });
    },
  });
}
