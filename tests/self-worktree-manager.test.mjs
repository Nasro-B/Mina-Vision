import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createSelfWorktreeManager } from '../src/code/self/self-worktree-manager.mjs';

const ROOT = path.resolve('/repo/.worktrees');
const cleanGit = () => vi.fn(async (args) => (args[0] === 'status' ? { stdout: '' } : { stdout: '', code: 0 }));

describe('self-worktree-manager (auto-modification T4.2)', () => {
  it('exige runGit + worktreesRoot', () => {
    expect(() => createSelfWorktreeManager({ runGit: () => {} })).toThrow('dependencies_required');
  });

  it('crée un worktree self/<demande>-<date> depuis HEAD, lie node_modules', async () => {
    const runGit = cleanGit();
    const linkNodeModules = vi.fn(async () => {});
    const m = createSelfWorktreeManager({ runGit, worktreesRoot: ROOT, now: () => Date.parse('2026-08-21T11:30:00Z'), linkNodeModules });
    const wt = await m.create({ request: 'améliore le Fast Path' });
    expect(wt.name).toMatch(/^self\/ameliore-le-fast-path-2026-08-21-11-30$/u);
    expect(wt.path.startsWith(ROOT)).toBe(true);
    expect(runGit).toHaveBeenCalledWith(['worktree', 'add', '-b', wt.name, wt.path, 'HEAD']);
    expect(linkNodeModules).toHaveBeenCalledWith(wt.path);
  });

  it('REFUSE si l’arbre vivant est sale (jamais partir d’un état non commité)', async () => {
    const runGit = vi.fn(async (args) => (args[0] === 'status' ? { stdout: ' M src/a.mjs\n' } : { stdout: '' }));
    const m = createSelfWorktreeManager({ runGit, worktreesRoot: ROOT });
    await expect(m.create({ request: 'x' })).rejects.toThrow('tree_dirty');
  });

  it('un SEUL worktree self actif à la fois', async () => {
    const m = createSelfWorktreeManager({ runGit: cleanGit(), worktreesRoot: ROOT });
    await m.create({ request: 'a' });
    await expect(m.create({ request: 'b' })).rejects.toThrow('already_active');
  });

  it('purge retire le worktree + la branche, libère le slot', async () => {
    const runGit = cleanGit();
    const m = createSelfWorktreeManager({ runGit, worktreesRoot: ROOT });
    const wt = await m.create({ request: 'a' });
    const purge = await m.purge();
    expect(purge).toMatchObject({ purged: true });
    expect(runGit).toHaveBeenCalledWith(['worktree', 'remove', '--force', wt.path]);
    expect(m.current()).toBeNull();
    // on peut recréer après purge
    await expect(m.create({ request: 'c' })).resolves.toBeTruthy();
  });
});
