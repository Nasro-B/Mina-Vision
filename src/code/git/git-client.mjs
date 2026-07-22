// Client Git : execFile('git', …) injecté — jamais de shell, jamais simple-git (mitigation
// Electron validée par la spec elle-même). push, force-push, --no-verify, reset --hard et
// clean -fd sont STRUCTURELLEMENT absents : même un appel interne ne peut pas les produire.
// Toute écriture passe par un callback de confirmation obligatoire.

const FORBIDDEN_TOKENS = Object.freeze(['push', '--no-verify', '--force', '-f']);
const FORBIDDEN_PAIRS = Object.freeze([
  ['reset', '--hard'],
  ['clean', '-fd'],
  ['clean', '-fdx'],
]);

function assertArgsAllowed(args) {
  const subcommand = args[0];
  if (FORBIDDEN_TOKENS.includes(subcommand)) {
    throw new Error(`git_operation_forbidden: ${subcommand}`);
  }
  for (const token of args) {
    if (token === '--no-verify') throw new Error('git_operation_forbidden: --no-verify');
  }
  for (const [first, second] of FORBIDDEN_PAIRS) {
    if (subcommand === first && args.includes(second)) {
      throw new Error(`git_operation_forbidden: ${first} ${second}`);
    }
  }
}

export function createGitClient({ runCommand, repoPath, confirm = async () => false } = {}) {
  if (!runCommand || typeof runCommand.run !== 'function') throw new TypeError('git_client_runner_required');
  if (typeof repoPath !== 'string' || repoPath.length === 0) throw new TypeError('git_client_repo_path_required');

  async function git(args, { timeout = 30_000 } = {}) {
    assertArgsAllowed(args);
    const result = await runCommand.run('git', args, { cwd: repoPath, timeout });
    if (result.code !== 0) {
      const detail = (result.stderr || result.stdout || result.error || '').trim();
      if (/not a git repository/iu.test(detail)) throw new Error('git_not_a_repository');
      throw new Error(`git_command_failed: git ${args[0]} — ${detail.slice(0, 400)}`);
    }
    return result.stdout;
  }

  async function requireConfirmation(operation, detail) {
    const accepted = await confirm({ operation, detail });
    if (accepted !== true) throw new Error(`git_confirmation_required: ${operation}`);
  }

  return Object.freeze({
    raw: (args, options) => git(args, options),

    async isRepository() {
      try {
        return (await git(['rev-parse', '--is-inside-work-tree'])).trim() === 'true';
      } catch {
        return false;
      }
    },

    // « branch --show-current » (et pas rev-parse HEAD) : fonctionne aussi sur un dépôt
    // fraîchement initialisé sans aucun commit. Vide (HEAD détachée) → 'HEAD'.
    currentBranch: async () => (await git(['branch', '--show-current'])).trim() || 'HEAD',
    show: (commitHash) => git(['show', '--stat', '--pretty=fuller', String(commitHash)]),
    branch: async () => (await git(['branch', '--list', '--format=%(refname:short)'])).split('\n').map((line) => line.trim()).filter(Boolean),
    remote: async () => (await git(['remote', '-v'])).split('\n').map((line) => line.trim()).filter(Boolean),

    async add(files) {
      if (!Array.isArray(files) || files.length === 0) throw new Error('git_client_files_required');
      await requireConfirmation('git add', files.join(', '));
      await git(['add', '--', ...files]);
    },

    async commit({ message, files } = {}) {
      if (typeof message !== 'string' || message.trim().length === 0) throw new Error('git_client_message_required');
      await requireConfirmation('git commit', message);
      const args = ['commit', '-m', message];
      if (Array.isArray(files) && files.length > 0) args.push('--', ...files);
      const output = await git(args);
      const hash = (await git(['rev-parse', 'HEAD'])).trim();
      return Object.freeze({ hash, output: output.trim() });
    },

    async checkout(branchName) {
      if (typeof branchName !== 'string' || branchName.trim().length === 0) throw new Error('git_client_branch_required');
      await requireConfirmation('git checkout', branchName);
      await git(['checkout', branchName]);
    },

    async createBranch(name) {
      if (typeof name !== 'string' || !/^[\w./-]+$/u.test(name)) throw new Error('git_client_branch_name_invalid');
      await requireConfirmation('git branch (création)', name);
      await git(['checkout', '-b', name]);
    },

    async stash({ message } = {}) {
      await requireConfirmation('git stash', message ?? '');
      await git(message ? ['stash', 'push', '-m', message] : ['stash', 'push']);
    },

    async stashPop() {
      await requireConfirmation('git stash pop', '');
      await git(['stash', 'pop']);
    },
  });
}
