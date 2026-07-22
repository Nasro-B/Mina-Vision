import { describe, expect, it, vi } from 'vitest';
import { createWindowsSandboxLauncher } from '../src/sandbox/windows-sandbox-launcher.mjs';

describe('Windows Sandbox launcher', () => {
  it('waits for the mapped guest receipt, closes the disposable VM, and returns the receipt', async () => {
    const startSession = vi.fn(async () => ({ started: true }));
    const execSession = vi.fn(async () => ({ exitCode: 0 }));
    const stopSession = vi.fn(async () => ({ stopped: true }));
    const receipt = { schemaVersion: 1, jobId: 'job-1', exitCode: 0 };
    let receiptReads = 0;
    const readFile = vi.fn(async (filename) => {
      if (filename.endsWith('.wsb')) return Buffer.from('<Configuration />');
      receiptReads += 1;
      if (receiptReads === 1) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      return Buffer.from(JSON.stringify(receipt));
    });
    const launcher = createWindowsSandboxLauncher({
      startSession,
      execSession,
      stopSession,
      readFile,
      wait: async () => {},
      clock: (() => { let time = 0; return () => { time += 10; return time; }; })(),
      ids: () => '11111111-1111-4111-8111-111111111111',
    });

    await expect(launcher.launch({
      executable: 'WindowsSandbox.exe', args: ['job.wsb'], timeoutMs: 1_000,
      jobId: 'job-1', outPath: 'G:\\jobs\\job-1\\out',
    })).resolves.toEqual({ exitCode: 0, receipt });
    expect(startSession).toHaveBeenCalledWith({
      sessionId: '11111111-1111-4111-8111-111111111111',
      configXml: '<Configuration />',
    });
    expect(execSession).toHaveBeenCalledWith({
      sessionId: '11111111-1111-4111-8111-111111111111',
      command: 'C:\\Mina\\bootstrap\\javascript\\node.exe C:\\Mina\\bootstrap\\mina-runner.mjs',
    });
    expect(stopSession).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111');
  });

  it('cancels only a known active job', async () => {
    const stopSession = vi.fn(async () => ({ stopped: true }));
    const launcher = createWindowsSandboxLauncher({
      startSession: vi.fn(async () => ({ started: true })),
      execSession: vi.fn(async () => ({ exitCode: 0 })),
      stopSession,
      readFile: vi.fn(async (filename) => filename.endsWith('.wsb') ? Buffer.from('<Configuration />') : new Promise(() => {})),
      wait: () => new Promise(() => {}),
      ids: () => '22222222-2222-4222-8222-222222222222',
    });
    void launcher.launch({
      executable: 'WindowsSandbox.exe', args: ['job.wsb'], timeoutMs: 10_000,
      jobId: 'job-2', outPath: 'G:\\jobs\\job-2\\out',
    });
    await Promise.resolve();

    await expect(launcher.cancel('job-2')).resolves.toEqual({ canceled: true, jobId: 'job-2' });
    await expect(launcher.cancel('unknown')).resolves.toEqual({ canceled: false, jobId: 'unknown' });
    expect(stopSession).toHaveBeenCalledWith('22222222-2222-4222-8222-222222222222');
  });
});
