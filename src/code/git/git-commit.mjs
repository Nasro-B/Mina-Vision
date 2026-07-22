// Commit gouverné : format « type(scope): message » imposé, garde de branches consultée,
// confirmation portée par le git-client, hook post-commit notifié après succès.

const COMMIT_FORMAT = /^(feat|fix|refactor|test|docs|chore|style|perf|ci|build|revert)(\([a-z0-9_-]+\))?: .{1,200}$/u;

export function validateCommitMessage(message) {
  if (typeof message !== 'string' || !COMMIT_FORMAT.test(message.trim())) {
    throw new Error(
      'git_commit_format_invalid: format requis « type(scope): message »\n'
      + 'Types : feat, fix, refactor, test, docs, chore, style, perf, ci, build, revert\n'
      + 'Exemple : fix(auth): JWT expiry set to 24h',
    );
  }
  return message.trim();
}

export function createGitCommit({ gitClient, branchGuard = null, postCommitHook = null } = {}) {
  if (!gitClient) throw new TypeError('git_commit_client_required');

  return Object.freeze({
    validateCommitMessage,

    async commit({ message, files } = {}) {
      const validated = validateCommitMessage(message);
      const branch = await gitClient.currentBranch();
      if (branchGuard) {
        const guard = branchGuard.guard('commit', branch);
        if (guard.allowed !== true) {
          throw new Error(`git_commit_branch_protected: ${branch} — ${guard.reason}`);
        }
      }
      if (Array.isArray(files) && files.length > 0) {
        await gitClient.add(files);
      }
      const result = await gitClient.commit({ message: validated, files });
      if (postCommitHook) {
        try {
          await postCommitHook.onCommit({
            hash: result.hash,
            message: validated,
            files: files ?? [],
            branch,
          });
        } catch {
          // Le hook mémoire ne doit jamais faire échouer un commit déjà créé.
        }
      }
      return Object.freeze({ ...result, branch, message: validated });
    },
  });
}
