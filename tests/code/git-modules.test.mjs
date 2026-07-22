import { describe, expect, it } from 'vitest';
import { createGitClient } from '../../src/code/git/git-client.mjs';
import { createGitStatus, parsePorcelainV2 } from '../../src/code/git/git-status.mjs';
import { createGitDiff, parseNumstat } from '../../src/code/git/git-diff.mjs';
import { parseBlame, parseLog } from '../../src/code/git/git-log.mjs';
import { createGitCommit, validateCommitMessage } from '../../src/code/git/git-commit.mjs';
import { createGitBranchGuard, parseProtectedBranches } from '../../src/code/git/git-branch-guard.mjs';
import { createGitPostCommitHook } from '../../src/code/git/git-hook-post-commit.mjs';

const US = String.fromCharCode(31);
const RS = String.fromCharCode(30);

function createFakeRunner(handler) {
  const calls = [];
  return {
    calls,
    run: async (command, args, options) => {
      calls.push({ command, args, options });
      return handler({ command, args });
    },
  };
}

describe('git-client — interdictions structurelles', () => {
  const runner = createFakeRunner(() => ({ code: 0, stdout: '', stderr: '' }));
  const client = createGitClient({ runCommand: runner, repoPath: 'C:/repo', confirm: async () => true });

  it.each([
    [['push']],
    [['push', 'origin', 'main']],
    [['push', '--force']],
    [['reset', '--hard', 'HEAD~1']],
    [['clean', '-fd']],
    [['commit', '-m', 'x', '--no-verify']],
  ])('refuse git %j même via raw()', async (args) => {
    await expect(client.raw(args)).rejects.toThrow(/git_operation_forbidden/u);
  });

  it('aucune méthode push n\'existe sur le client', () => {
    expect(client.push).toBeUndefined();
    expect(client.forcePush).toBeUndefined();
  });

  it('dépôt absent → git_not_a_repository', async () => {
    const failing = createGitClient({
      runCommand: createFakeRunner(() => ({ code: 128, stdout: '', stderr: 'fatal: not a git repository' })),
      repoPath: 'C:/pas-un-depot',
    });
    await expect(failing.raw(['status'])).rejects.toThrow(/git_not_a_repository/u);
  });

  it('échec git → erreur nominée avec stderr borné', async () => {
    const failing = createGitClient({
      runCommand: createFakeRunner(() => ({ code: 1, stdout: '', stderr: 'boom' })),
      repoPath: 'C:/repo',
    });
    await expect(failing.raw(['status'])).rejects.toThrow(/git_command_failed: git status — boom/u);
  });
});

describe('git-client — confirmations d\'écriture', () => {
  it('add/commit/checkout/stash sans confirmation → git_confirmation_required', async () => {
    const runner = createFakeRunner(() => ({ code: 0, stdout: '', stderr: '' }));
    const client = createGitClient({ runCommand: runner, repoPath: 'C:/repo' });
    await expect(client.add(['a.mjs'])).rejects.toThrow(/git_confirmation_required/u);
    await expect(client.commit({ message: 'feat(x): y' })).rejects.toThrow(/git_confirmation_required/u);
    await expect(client.checkout('dev')).rejects.toThrow(/git_confirmation_required/u);
    await expect(client.stash()).rejects.toThrow(/git_confirmation_required/u);
    expect(runner.calls).toHaveLength(0);
  });

  it('confirmation accordée → la commande part avec -- pour les chemins', async () => {
    const runner = createFakeRunner(({ args }) => ({
      code: 0,
      stdout: args[0] === 'rev-parse' ? 'abc123def\n' : '',
      stderr: '',
    }));
    const client = createGitClient({ runCommand: runner, repoPath: 'C:/repo', confirm: async () => true });
    await client.add(['a.mjs']);
    expect(runner.calls[0].args).toEqual(['add', '--', 'a.mjs']);
    const commit = await client.commit({ message: 'feat(x): y' });
    expect(commit.hash).toBe('abc123def');
  });

  it('nom de branche invalide refusé avant toute commande', async () => {
    const runner = createFakeRunner(() => ({ code: 0, stdout: '', stderr: '' }));
    const client = createGitClient({ runCommand: runner, repoPath: 'C:/repo', confirm: async () => true });
    await expect(client.createBranch('a b;rm')).rejects.toThrow(/branch_name_invalid/u);
    expect(runner.calls).toHaveLength(0);
  });
});

describe('git-status — parse porcelain v2', () => {
  it('parse branche, ahead/behind, staged/modified/untracked', () => {
    const status = parsePorcelainV2([
      '# branch.head main',
      '# branch.upstream origin/main',
      '# branch.ab +2 -1',
      '1 M. N... 100644 100644 100644 aaa bbb src/modifie-stage.mjs',
      '1 .M N... 100644 100644 100644 aaa bbb src/modifie-worktree.mjs',
      '? nouveau.txt',
    ].join('\n'));
    expect(status.branch).toBe('main');
    expect(status.upstream).toBe('origin/main');
    expect(status.ahead).toBe(2);
    expect(status.behind).toBe(1);
    expect(status.staged).toEqual(['src/modifie-stage.mjs']);
    expect(status.modified).toEqual(['src/modifie-worktree.mjs']);
    expect(status.untracked).toEqual(['nouveau.txt']);
    expect(status.clean).toBe(false);
  });

  it('arbre propre → clean true', () => {
    expect(parsePorcelainV2('# branch.head main').clean).toBe(true);
  });

  it('createGitStatus délègue au client', async () => {
    const gitStatus = createGitStatus({
      gitClient: { raw: async (args) => {
        expect(args).toEqual(['status', '--porcelain=v2', '--branch']);
        return '# branch.head dev';
      } },
    });
    expect((await gitStatus.status()).branch).toBe('dev');
  });
});

describe('git-diff — numstat', () => {
  it('parse ajouts/suppressions et binaires', () => {
    const entries = parseNumstat('12\t3\tsrc/app.mjs\n-\t-\timage.png\n');
    expect(entries[0]).toMatchObject({ file: 'src/app.mjs', additions: 12, deletions: 3, binary: false });
    expect(entries[1]).toMatchObject({ file: 'image.png', binary: true });
  });

  it('construit les arguments staged/from/to/file', async () => {
    const seen = [];
    const gitDiff = createGitDiff({ gitClient: { raw: async (args) => { seen.push(args); return ''; } } });
    await gitDiff.diff({ staged: true });
    await gitDiff.diff({ from: 'v1', to: 'v2', file: 'a.mjs' });
    expect(seen[0]).toEqual(['diff', '--cached']);
    expect(seen[1]).toEqual(['diff', 'v1..v2', '--', 'a.mjs']);
  });
});

describe('git-log — parse', () => {
  it('parse le log aux séparateurs unitaires (messages avec : et | intacts)', () => {
    const raw = `aaaa1111${US}Nasro${US}2026-07-20T10:00:00+02:00${US}feat(x): sujet | avec pipes${RS}bbbb2222${US}Mina${US}2026-07-19T09:00:00+02:00${US}fix: autre${RS}`;
    const entries = parseLog(raw);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ shortHash: 'aaaa111', author: 'Nasro', subject: 'feat(x): sujet | avec pipes' });
  });

  it('parse le blame line-porcelain', () => {
    const hash = 'a'.repeat(40);
    const blame = parseBlame([
      `${hash} 1 1 1`,
      'author Nasro',
      'author-mail <n@x>',
      '\tconst x = 1;',
    ].join('\n'));
    expect(blame[0]).toMatchObject({ line: 1, author: 'Nasro', content: 'const x = 1;', shortHash: 'aaaaaaa' });
  });
});

describe('git-commit — format et garde', () => {
  it.each([
    'feat(auth): nouvelle validation',
    'fix: correctif simple',
    'refactor(ui-core): remaniement',
    'revert: annulation',
  ])('accepte « %s »', (message) => {
    expect(validateCommitMessage(message)).toBe(message);
  });

  it.each([
    'ajout de fichier',
    'Feat(x): majuscule interdite',
    'feat(X): scope majuscule interdit',
    'feat(x) manque deux-points',
    'feat(x): ',
    'push: pas un type valide',
  ])('rejette « %s »', (message) => {
    expect(() => validateCommitMessage(message)).toThrow(/git_commit_format_invalid/u);
  });

  it('refuse le commit sur branche protégée AVANT git add', async () => {
    const guard = createGitBranchGuard({ protectedBranches: ['Main-Sauvegarde-V1'] });
    let added = false;
    const commit = createGitCommit({
      gitClient: {
        currentBranch: async () => 'Main-Sauvegarde-V1',
        add: async () => { added = true; },
        commit: async () => ({ hash: 'x' }),
      },
      branchGuard: guard,
    });
    await expect(commit.commit({ message: 'feat(x): y', files: ['a.mjs'] }))
      .rejects.toThrow(/git_commit_branch_protected/u);
    expect(added).toBe(false);
  });

  it('commit complet : add → commit → hook post-commit notifié, panne du hook non bloquante', async () => {
    const events = [];
    const commit = createGitCommit({
      gitClient: {
        currentBranch: async () => 'feature/jwt',
        add: async (files) => events.push(['add', files]),
        commit: async ({ message }) => { events.push(['commit', message]); return { hash: 'abcdef1234', output: 'ok' }; },
      },
      postCommitHook: { onCommit: async (payload) => { events.push(['hook', payload.hash]); throw new Error('panne mémoire'); } },
    });
    const result = await commit.commit({ message: 'feat(auth): jwt', files: ['src/a.mjs'] });
    expect(result).toMatchObject({ hash: 'abcdef1234', branch: 'feature/jwt' });
    expect(events).toEqual([
      ['add', ['src/a.mjs']],
      ['commit', 'feat(auth): jwt'],
      ['hook', 'abcdef1234'],
    ]);
  });
});

describe('git-branch-guard', () => {
  it('parse « NE JAMAIS MODIFIER : » et « branches protégées : » depuis les fichiers de gouvernance', () => {
    const text = [
      'Règles du dépôt.',
      'NE JAMAIS MODIFIER : Main-Sauvegarde-V1, Main-Sauvegarde',
      'Branches protégées : production et release/v2',
    ].join('\n');
    const branches = parseProtectedBranches(text);
    expect(branches).toContain('Main-Sauvegarde-V1');
    expect(branches).toContain('Main-Sauvegarde');
    expect(branches).toContain('production');
    expect(branches).toContain('release/v2');
    expect(parseProtectedBranches(null)).toEqual([]);
  });

  it('guard : écriture refusée sur branche protégée, lecture autorisée, branche libre OK', () => {
    const guard = createGitBranchGuard({
      protectedBranches: ['sauvegarde'],
      projectContext: { minaMd: 'NE JAMAIS MODIFIER : archive-2025' },
    });
    expect(guard.guard('commit', 'sauvegarde').allowed).toBe(false);
    expect(guard.guard('code.git.commit', 'archive-2025').allowed).toBe(false);
    expect(guard.guard('log', 'sauvegarde').allowed).toBe(true);
    expect(guard.guard('commit', 'feature/libre').allowed).toBe(true);
    expect(guard.guard('commit', '').allowed).toBe(false);
    expect(guard.listProtected()).toContain('archive-2025');
  });

  it('addProtection ajoute dynamiquement et isPushAllowed est TOUJOURS false', () => {
    const guard = createGitBranchGuard();
    guard.addProtection('main', 'décision Nasro');
    expect(guard.guard('rebase', 'main').allowed).toBe(false);
    expect(guard.isPushAllowed()).toBe(false);
  });
});

describe('git-hook-post-commit', () => {
  it('décompose le message, écrit mémoire + journal (API réelle append)', async () => {
    const memories = [];
    const journal = [];
    const hook = createGitPostCommitHook({
      memoryService: { recordEvent: async (kind, entry) => memories.push([kind, entry]) },
      activityJournal: { append: (kind, entry) => journal.push([kind, entry]) },
    });
    const result = await hook.onCommit({
      hash: 'abcdef1234567',
      message: 'fix(auth): JWT expiry set to 24h',
      files: ['src/auth.mjs'],
      project: 'swapi',
      branch: 'dev',
    });
    expect(result.entry).toMatchObject({
      type: 'fix',
      scope: 'auth',
      description: 'JWT expiry set to 24h',
      hash: 'abcdef1',
      project: 'swapi',
    });
    expect(result.outcomes).toEqual({ memory: true, journal: true });
    expect(memories[0][0]).toBe('git.commit');
    expect(journal[0][0]).toBe('git.commit');
  });

  it('fail-soft : mémoire en panne → outcomes.memory false, jamais d\'exception', async () => {
    const hook = createGitPostCommitHook({
      memoryService: { recordEvent: async () => { throw new Error('firebase down'); } },
    });
    const result = await hook.onCommit({ hash: 'aaaa111', message: 'chore: x' });
    expect(result.outcomes).toEqual({ memory: false, journal: false });
  });

  it('valide hash et message', async () => {
    const hook = createGitPostCommitHook();
    await expect(hook.onCommit({ message: 'x' })).rejects.toThrow(/hash_required/u);
    await expect(hook.onCommit({ hash: 'a' })).rejects.toThrow(/message_required/u);
  });
});
