// Garde des branches protégées : liste peuplée depuis la configuration explicite et les fichiers
// de gouvernance du projet (MINA.md/AGENTS.md — motif « NE JAMAIS MODIFIER : … » ou « branche
// protégée : … »). isPushAllowed() est structurellement false : le push n'existe pas dans Mina Code.

const WRITE_OPERATIONS = new Set(['commit', 'checkout', 'branch-delete', 'rebase', 'merge', 'reset', 'stash-pop']);

export function parseProtectedBranches(text) {
  const found = new Set();
  if (typeof text !== 'string') return Object.freeze([]);
  const patterns = [
    /ne jamais modifier\s*:?\s*([^\n]+)/giu,
    /branches?\s+prot[ée]g[ée]es?\s*(?:\(.*?\))?\s*:?\s*([^\n]+)/giu,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      for (const token of match[1].split(/[,+·;]|\bet\b/u)) {
        const candidate = token.trim().replace(/^[`'"*\s]+|[`'"*\s.]+$/gu, '').split(/\s|=/u)[0];
        if (/^[\w][\w./-]*$/u.test(candidate ?? '') && candidate.length > 1) found.add(candidate);
      }
    }
  }
  return Object.freeze([...found]);
}

export function createGitBranchGuard({ protectedBranches = [], projectContext = null } = {}) {
  const protections = new Map();
  const protect = (branch, reason) => {
    if (typeof branch === 'string' && branch.length > 0 && !protections.has(branch)) {
      protections.set(branch, reason);
    }
  };

  for (const branch of protectedBranches) protect(branch, 'configuration locale Mina');
  for (const [key, label] of [['minaMd', 'MINA.md'], ['agentsMd', 'AGENTS.md'], ['claudeMd', 'CLAUDE.md']]) {
    for (const branch of parseProtectedBranches(projectContext?.[key])) {
      protect(branch, `déclarée protégée dans ${label}`);
    }
  }

  return Object.freeze({
    guard(operation, branch) {
      const normalized = String(operation ?? '').replace(/^code\.git\./u, '');
      if (typeof branch !== 'string' || branch.length === 0) {
        return Object.freeze({ allowed: false, reason: 'git_branch_guard_branch_required' });
      }
      if (!protections.has(branch)) return Object.freeze({ allowed: true, reason: 'branche non protégée' });
      if (WRITE_OPERATIONS.has(normalized) || normalized === 'commit') {
        return Object.freeze({
          allowed: false,
          reason: `branche protégée (${protections.get(branch)})`,
        });
      }
      return Object.freeze({ allowed: true, reason: 'lecture autorisée sur branche protégée' });
    },

    listProtected: () => Object.freeze([...protections.keys()]),

    addProtection(branch, reason = 'ajout manuel') {
      if (typeof branch !== 'string' || branch.length === 0) throw new Error('git_branch_guard_branch_required');
      protections.set(branch, reason);
    },

    // Toujours false — le push n'existe pas dans Mina Code, par construction.
    isPushAllowed: () => false,
  });
}
