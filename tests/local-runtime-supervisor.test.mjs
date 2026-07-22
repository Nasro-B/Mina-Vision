import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { createLocalRuntimeSupervisor } from '../src/runtime/local-runtime-supervisor.mjs';

function processStub() {
  const child = new EventEmitter();
  child.kill = vi.fn((signal) => {
    if (signal === 'SIGTERM') queueMicrotask(() => child.emit('exit', 0, null));
    return true;
  });
  return child;
}

describe('local runtime supervisor', () => {
  it('reports closed ports/timeouts and never auto-launches a disabled runtime', async () => {
    const spawnProcess = vi.fn();
    const supervisor = createLocalRuntimeSupervisor({
      runtimes: [{ id: 'lm-studio', enabled: false, healthUrl: 'http://127.0.0.1:1234/v1/models', command: 'lms', args: ['server', 'start'] }],
      fetchImpl: vi.fn(async () => { throw new TypeError('fetch failed'); }),
      spawnProcess,
      probeTimeoutMs: 5,
    });

    await expect(supervisor.probe('lm-studio')).resolves.toMatchObject({ available: false, reason: 'connection_failed' });
    await expect(supervisor.ensureAvailable('lm-studio')).rejects.toThrow('local_runtime_disabled:lm-studio');
    expect(spawnProcess).not.toHaveBeenCalled();
  });

  it('does not own an already-running process and stops only a process it launched', async () => {
    const child = processStub();
    const spawnProcess = vi.fn(() => child);
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      if (calls === 1) return new Response('{}', { status: 200 });
      if (calls === 2) throw new TypeError('closed');
      return new Response('{}', { status: 200 });
    });
    const runtime = { id: 'lm-studio', enabled: true, healthUrl: 'http://127.0.0.1:1234/v1/models', command: 'lms', args: ['server', 'start'] };
    const supervisor = createLocalRuntimeSupervisor({ runtimes: [runtime], fetchImpl, spawnProcess, startupTimeoutMs: 100, shutdownTimeoutMs: 20 });

    await expect(supervisor.ensureAvailable('lm-studio')).resolves.toMatchObject({ available: true, owned: false });
    expect(spawnProcess).not.toHaveBeenCalled();
    await expect(supervisor.ensureAvailable('lm-studio')).resolves.toMatchObject({ available: true, owned: true });
    expect(spawnProcess).toHaveBeenCalledOnce();
    await supervisor.stopOwned();
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(supervisor.status('lm-studio').owned).toBe(false);
  });
});
