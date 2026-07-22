// Test d'intégration sur un VRAI dépôt git temporaire : git init → commits → status/log/diff/
// blame/commit gouverné. Sauté proprement si git n'est pas installé sur la machine.

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCommandRunner } from '../../src/code/run-command.mjs';
import { createGitClient } from '../../src/code/git/git-client.mjs';
import { createGitStatus } from '../../src/code/git/git-status.mjs';
import { createGitDiff } from '../../src/code/git/git-diff.mjs';
import { createGitLog } from '../../src/code/git/git-log.mjs';
import { createGitCommit } from '../../src/code/git/git-commit.mjs';
import { createGitBranchGuard } from '../../src/code/git/git-branch-guard.mjs';
import { createGitPostCommitHook } from '../../src/code/git/git-hook-post-commit.mjs';

const runner = createCommandRunner();
const gitAvailable = (await runner.run('git', ['--version'])).code === 0;

describe.skipIf(!gitAvailable)('git — dépôt réel temporaire', () => {
  let repoPath;
  let client;

  beforeAll(async () => {
    repoPath = await mkdtemp(join(tmpdir(), 'mina-git-'));
    client = createGitClient({ runCommand: runner, repoPath, confirm: async () => true });
    await runner.run('git', ['init', '--initial-branch=main'], { cwd: repoPath });
    await runner.run('git', ['config', 'user.email', 'mina@test.local'], { cwd: repoPath });
    await runner.run('git', ['config', 'user.name', 'Mina Test'], { cwd: repoPath });
    await writeFile(join(repoPath, 'app.mjs'), 'export const version = 1;\n', 'utf8');
  });

  afterAll(async () => {
    await rm(repoPath, { recursive: true, force: true }).catch(() => {});
  });

  it('isRepository true dans le dépôt, false hors dépôt', async () => {
    expect(await client.isRepository()).toBe(true);
    const outside = createGitClient({ runCommand: runner, repoPath: tmpdir() });
    expect(await outside.isRepository()).toBe(false);
  });

  it('status : untracked → staged → commit gouverné → clean', async () => {
    const gitStatus = createGitStatus({ gitClient: client });
    const before = await gitStatus.status();
    expect(before.branch).toBe('main');
    expect(before.untracked).toContain('app.mjs');

    const journal = [];
    const gitCommit = createGitCommit({
      gitClient: client,
      branchGuard: createGitBranchGuard({ protectedBranches: ['sauvegarde-intouchable'] }),
      postCommitHook: createGitPostCommitHook({
        activityJournal: { append: (kind, entry) => journal.push([kind, entry]) },
      }),
    });
    const result = await gitCommit.commit({ message: 'feat(app): version initiale', files: ['app.mjs'] });
    expect(result.hash).toMatch(/^[0-9a-f]{40}$/u);
    expect(result.branch).toBe('main');
    expect(journal[0][0]).toBe('git.commit');
    expect(journal[0][1].type).toBe('feat');

    const after = await gitStatus.status();
    expect(after.clean).toBe(true);
  });

  it('diff + numstat sur modification réelle', async () => {
    await writeFile(join(repoPath, 'app.mjs'), 'export const version = 2;\n', 'utf8');
    const gitDiff = createGitDiff({ gitClient: client });
    const text = await gitDiff.diff({});
    expect(text).toContain('-export const version = 1;');
    expect(text).toContain('+export const version = 2;');
    const numstat = await gitDiff.numstat({});
    expect(numstat[0]).toMatchObject({ file: 'app.mjs', additions: 1, deletions: 1 });
  });

  it('log et blame parsés depuis le vrai git', async () => {
    // Le test précédent a laissé une modification non commitée : on restaure, sinon blame
    // attribue la ligne à « Not Committed Yet ».
    await client.raw(['checkout', '--', 'app.mjs']);
    const gitLog = createGitLog({ gitClient: client });
    const entries = await gitLog.log({ maxCount: 5 });
    expect(entries[0].subject).toBe('feat(app): version initiale');
    expect(entries[0].author).toBe('Mina Test');
    const blame = await gitLog.blame('app.mjs');
    expect(blame[0].author).toBe('Mina Test');
    expect(blame[0].content).toBe('export const version = 1;');
  });

  it('le push reste impossible même sur un vrai dépôt', async () => {
    await expect(client.raw(['push', 'origin', 'main'])).rejects.toThrow(/git_operation_forbidden/u);
  });

  it('commit refusé sur branche protégée réelle', async () => {
    await client.createBranch('sauvegarde-intouchable');
    const gitCommit = createGitCommit({
      gitClient: client,
      branchGuard: createGitBranchGuard({ protectedBranches: ['sauvegarde-intouchable'] }),
    });
    await writeFile(join(repoPath, 'app.mjs'), 'export const version = 3;\n', 'utf8');
    await expect(gitCommit.commit({ message: 'feat(app): interdit', files: ['app.mjs'] }))
      .rejects.toThrow(/git_commit_branch_protected/u);
    await client.raw(['checkout', '--', 'app.mjs']);
    await client.checkout('main');
  });
});
