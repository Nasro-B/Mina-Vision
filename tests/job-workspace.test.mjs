import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createJobWorkspaceManager } from '../src/sandbox/job-workspace.mjs';

let root;
let sources;
let workspaces;
let bootstrap;

function digest(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'mina-job-workspace-'));
  sources = join(root, 'confirmed-sources');
  workspaces = join(root, 'jobs');
  bootstrap = join(root, 'bootstrap');
  await Promise.all([mkdir(sources), mkdir(workspaces), mkdir(bootstrap)]);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('ephemeral sandbox job workspace', () => {
  it('copies only digest-confirmed files into a private source mount and creates a separate out mount', async () => {
    const bytes = Buffer.from('print("Mina")\n');
    await mkdir(join(sources, 'src'));
    await writeFile(join(sources, 'src', 'main.py'), bytes);
    const manager = createJobWorkspaceManager({ root: workspaces, bootstrapPath: bootstrap });
    const workspace = await manager.prepare({
      jobId: 'job-1',
      sourceRoot: sources,
      job: {
        sourceFiles: [{ path: 'src/main.py', digest: digest(bytes), mode: 'read-only' }],
        entrypoint: 'src/main.py', limits: { wallMs: 30_000 },
      },
    });

    expect(workspace).toMatchObject({ jobId: 'job-1', bootstrapPath: bootstrap });
    expect(workspace.sourcePath).not.toBe(sources);
    expect(await readFile(join(workspace.sourcePath, 'src', 'main.py'))).toEqual(bytes);
    expect(workspace.outPath).not.toBe(workspace.sourcePath);
    expect(JSON.parse(await readFile(join(workspace.sourcePath, 'job.json'), 'utf8'))).toMatchObject({ jobId: 'job-1', entrypoint: 'src/main.py' });
  });

  it('fails closed on a changed digest or source reparse point and removes partial workspaces', async () => {
    await writeFile(join(sources, 'main.py'), 'changed');
    const manager = createJobWorkspaceManager({ root: workspaces, bootstrapPath: bootstrap });
    await expect(manager.prepare({
      jobId: 'job-bad', sourceRoot: sources,
      job: { sourceFiles: [{ path: 'main.py', digest: `sha256:${'a'.repeat(64)}`, mode: 'read-only' }] },
    })).rejects.toThrow('sandbox_source_digest_mismatch:main.py');
    await expect(readFile(join(workspaces, 'job-bad', 'src', 'main.py'))).rejects.toThrow();

    const external = join(root, 'external.py');
    await writeFile(external, 'hostile');
    await symlink(external, join(sources, 'linked.py'), 'file');
    await expect(manager.prepare({
      jobId: 'job-link', sourceRoot: sources,
      job: { sourceFiles: [{ path: 'linked.py', digest: digest(Buffer.from('hostile')), mode: 'read-only' }] },
    })).rejects.toThrow('sandbox_source_reparse_forbidden');
  });

  it('cleans explicit jobs and stale crash leftovers without touching active jobs', async () => {
    const manager = createJobWorkspaceManager({ root: workspaces, bootstrapPath: bootstrap, clock: () => Date.now() + 10_000 });
    await mkdir(join(workspaces, 'stale'));
    await mkdir(join(workspaces, 'active'));
    const result = await manager.cleanupOrphans({ activeJobIds: ['active'], olderThanMs: 0 });
    expect(result).toEqual({ removed: ['stale'] });
    await expect(readFile(join(workspaces, 'active', 'missing'))).rejects.toThrow();
    expect(await manager.cleanup('active')).toBe(true);
  });
});
