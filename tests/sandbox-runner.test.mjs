import { describe, expect, it, vi } from 'vitest';
import { createSandboxRunner } from '../src/sandbox/sandbox-runner.mjs';

describe('sandbox runner', () => {
  it('prepares a digest-bound workspace and returns the verified guest receipt', async () => {
    const receipt = {
      schemaVersion: 1,
      jobId: 'job-1',
      sourceDigest: `sha256:${'a'.repeat(64)}`,
      exitCode: 0,
      artifacts: [],
    };
    const workspaceManager = {
      prepare: vi.fn(async () => ({
        sourcePath: 'G:\\sandbox\\job-1\\src',
        outPath: 'G:\\sandbox\\job-1\\out',
        bootstrapPath: 'G:\\sandbox-runtime',
      })),
    };
    const backend = { execute: vi.fn(async () => ({ exitCode: 0, receipt })) };
    const launcher = { cancel: vi.fn(() => ({ canceled: false, jobId: 'job-1' })) };
    const runner = createSandboxRunner({ backend, workspaceManager, launcher });
    const job = { sourceDigest: receipt.sourceDigest, limits: { wallMs: 30_000 }, sourceFiles: [{}] };

    await expect(runner.execute({ jobId: 'job-1', sourceRoot: 'C:\\sources', job }))
      .resolves.toMatchObject({ jobId: 'job-1', status: 'completed', exitCode: 0, artifacts: [] });
    expect(workspaceManager.prepare).toHaveBeenCalledWith({ jobId: 'job-1', sourceRoot: 'C:\\sources', job });
    expect(backend.execute).toHaveBeenCalledWith(expect.objectContaining({ jobId: 'job-1', job }));
  });

  it('rejects a receipt that does not match the requested job', async () => {
    const runner = createSandboxRunner({
      backend: { execute: vi.fn(async () => ({ receipt: { schemaVersion: 1, jobId: 'other', sourceDigest: `sha256:${'a'.repeat(64)}`, artifacts: [] } })) },
      workspaceManager: { prepare: vi.fn(async () => ({ sourcePath: 'a', outPath: 'b', bootstrapPath: 'c' })) },
      launcher: { cancel: vi.fn() },
    });
    await expect(runner.execute({
      jobId: 'job-1', sourceRoot: 'C:\\sources',
      job: { sourceDigest: `sha256:${'a'.repeat(64)}`, limits: { wallMs: 1 }, sourceFiles: [{}] },
    })).rejects.toThrow('sandbox_receipt_invalid');
  });
});
