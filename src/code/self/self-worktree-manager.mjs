import path from 'node:path';

// Auto-modification T4.2 (SPEC agente-codage V4) : l'auto-modification travaille TOUJOURS dans un git
// worktree isolé — JAMAIS dans l'arbre vivant de Mina. Créé depuis un HEAD PROPRE (refus si l'arbre est
// sale), nommé `self/<demande>-<date>`, un SEUL worktree self actif à la fois, purgé après merge ou
// abandon. Le worktree hérite des node_modules par lien (pas de réinstall). Jamais un chemin hors du
// répertoire de worktrees. Injectable (runGit + now + linkNodeModules) → testable sans vrai git.

function slug(text) {
  return String(text ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/gu, '')
    .toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-+|-+$/gu, '')
    .slice(0, 40) || 'change';
}

function stamp(ms) {
  return new Date(ms).toISOString().slice(0, 16).replace(/[:T]/gu, '-'); // 2026-08-21-11-30
}

export function createSelfWorktreeManager({ runGit, worktreesRoot, now = () => Date.now(), linkNodeModules = null } = {}) {
  if (typeof runGit !== 'function' || !worktreesRoot) throw new TypeError('self_worktree_manager_dependencies_required');
  const root = path.resolve(worktreesRoot);
  let active = null;

  return Object.freeze({
    async create({ request } = {}) {
      if (active) throw new Error('self_worktree_already_active'); // un seul à la fois
      // Refus si l'arbre vivant est sale : on ne part JAMAIS d'un état non commité.
      const status = await runGit(['status', '--porcelain']);
      if (String(status?.stdout ?? '').trim() !== '') throw new Error('self_worktree_tree_dirty');

      const name = `self/${slug(request)}-${stamp(now())}`;
      const wtPath = path.resolve(root, name.replace('/', path.sep));
      // Jamais hors du répertoire de worktrees (anti-évasion de chemin).
      const withSep = root.endsWith(path.sep) ? root : root + path.sep;
      if (!wtPath.startsWith(withSep)) throw new Error('self_worktree_path_escape');

      await runGit(['worktree', 'add', '-b', name, wtPath, 'HEAD']);
      if (typeof linkNodeModules === 'function') await linkNodeModules(wtPath);
      active = Object.freeze({ name, path: wtPath });
      return active;
    },

    async purge() {
      if (!active) return Object.freeze({ purged: false, reason: 'aucun_worktree_actif' });
      const { name, path: wtPath } = active;
      await runGit(['worktree', 'remove', '--force', wtPath]);
      try { await runGit(['branch', '-D', name]); } catch { /* branche déjà partie */ }
      active = null;
      return Object.freeze({ purged: true, name });
    },

    current: () => active,
  });
}
