import { createHash } from 'node:crypto';
import { chmod, copyFile, lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';

const SAFE_ID = /^[a-z0-9][a-z0-9-]{0,100}$/u;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;

function safePath(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.startsWith('/') || /^[a-z]:/iu.test(value)
    || value.split('/').some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new TypeError('sandbox_source_path_invalid');
  }
  return value;
}

function within(root, target, error) {
  const base = resolve(root);
  const value = resolve(target);
  if (value !== base && !value.startsWith(`${base}${sep}`)) throw new Error(error);
  return value;
}

export function createJobWorkspaceManager({ root, bootstrapPath, clock = Date.now } = {}) {
  if (!root || !bootstrapPath) throw new TypeError('sandbox_workspace_dependencies_required');
  const workspaceRoot = resolve(root);
  const bootstrap = resolve(bootstrapPath);
  const now = () => Number(typeof clock === 'function' ? clock() : clock.now());

  async function prepare({ jobId, sourceRoot, job } = {}) {
    if (!SAFE_ID.test(jobId ?? '') || !sourceRoot || !Array.isArray(job?.sourceFiles) || !job.sourceFiles.length) {
      throw new TypeError('sandbox_workspace_request_invalid');
    }
    await mkdir(workspaceRoot, { recursive: true });
    const jobRoot = within(workspaceRoot, join(workspaceRoot, jobId), 'sandbox_workspace_escape');
    const sourcePath = join(jobRoot, 'src');
    const outPath = join(jobRoot, 'out');
    await mkdir(sourcePath, { recursive: true });
    await mkdir(outPath, { recursive: true });
    try {
      const confirmedRoot = await realpath(resolve(sourceRoot));
      for (const source of job.sourceFiles) {
        const path = safePath(source.path);
        if (source.mode !== 'read-only' || !DIGEST.test(source.digest ?? '')) throw new TypeError('sandbox_source_invalid');
        const input = within(confirmedRoot, join(confirmedRoot, ...path.split('/')), 'sandbox_source_escape');
        const stat = await lstat(input);
        if (stat.isSymbolicLink()) throw new Error('sandbox_source_reparse_forbidden');
        if (!stat.isFile()) throw new Error(`sandbox_source_not_file:${path}`);
        const inputReal = await realpath(input);
        within(confirmedRoot, inputReal, 'sandbox_source_escape');
        const bytes = await readFile(inputReal);
        const actual = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
        if (actual !== source.digest) throw new Error(`sandbox_source_digest_mismatch:${path}`);
        const output = within(sourcePath, join(sourcePath, ...path.split('/')), 'sandbox_workspace_escape');
        await mkdir(dirname(output), { recursive: true });
        await copyFile(inputReal, output);
        await chmod(output, 0o444);
      }
      const manifestPath = join(sourcePath, 'job.json');
      await writeFile(manifestPath, `${JSON.stringify({ jobId, ...job })}\n`, { flag: 'wx', mode: 0o444 });
      return Object.freeze({ jobId, jobRoot, sourcePath, outPath, bootstrapPath: bootstrap });
    } catch (error) {
      await rm(jobRoot, { recursive: true, force: true });
      throw error;
    }
  }

  async function cleanup(jobId) {
    if (!SAFE_ID.test(jobId ?? '')) throw new TypeError('sandbox_job_id_invalid');
    const path = within(workspaceRoot, join(workspaceRoot, jobId), 'sandbox_workspace_escape');
    const stat = await lstat(path).catch(() => null);
    if (!stat) return false;
    if (stat.isSymbolicLink()) throw new Error('sandbox_workspace_reparse_forbidden');
    await rm(path, { recursive: true, force: true });
    return true;
  }

  async function cleanupOrphans({ activeJobIds = [], olderThanMs = 24 * 60 * 60_000 } = {}) {
    if (!Array.isArray(activeJobIds) || !Number.isFinite(olderThanMs) || olderThanMs < 0) throw new TypeError('sandbox_cleanup_invalid');
    await mkdir(workspaceRoot, { recursive: true });
    const active = new Set(activeJobIds);
    const removed = [];
    for (const entry of await readdir(workspaceRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || !SAFE_ID.test(entry.name) || active.has(entry.name)) continue;
      const path = within(workspaceRoot, join(workspaceRoot, entry.name), 'sandbox_workspace_escape');
      const stat = await lstat(path);
      if (stat.isSymbolicLink()) continue;
      if (now() - stat.mtimeMs < olderThanMs) continue;
      await rm(path, { recursive: true, force: true });
      removed.push(entry.name);
    }
    return Object.freeze({ removed: Object.freeze(removed.sort()) });
  }

  return Object.freeze({ prepare, cleanup, cleanupOrphans });
}
