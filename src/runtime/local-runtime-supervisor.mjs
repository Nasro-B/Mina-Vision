import { spawn } from 'node:child_process';
import { once } from 'node:events';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function createLocalRuntimeSupervisor({
  runtimes = [],
  fetchImpl = fetch,
  spawnProcess = (command, args, options) => spawn(command, args, options),
  probeTimeoutMs = 2_000,
  startupTimeoutMs = 15_000,
  shutdownTimeoutMs = 2_000,
} = {}) {
  const declarations = new Map(runtimes.map((runtime) => [runtime.id, Object.freeze({ ...runtime })]));
  if (declarations.size !== runtimes.length || runtimes.some((runtime) => !runtime.id || !runtime.healthUrl)) {
    throw new TypeError('local_runtime_declarations_invalid');
  }
  const owned = new Map();
  const states = new Map();

  function declaration(id) {
    const runtime = declarations.get(id);
    if (!runtime) throw new Error(`local_runtime_unknown:${id}`);
    return runtime;
  }

  async function probe(id) {
    const runtime = declaration(id);
    const controller = new AbortController();
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error('timeout'));
      }, probeTimeoutMs);
      timer.unref?.();
    });
    let result;
    try {
      const response = await Promise.race([fetchImpl(runtime.healthUrl, { signal: controller.signal }), timeout]);
      result = response.ok
        ? { available: true, reason: null }
        : { available: false, reason: `http_${response.status}` };
    } catch (error) {
      result = { available: false, reason: error.message === 'timeout' ? 'timeout' : 'connection_failed' };
    } finally {
      clearTimeout(timer);
    }
    const state = Object.freeze({ id, ...result, owned: owned.has(id) });
    states.set(id, state);
    return state;
  }

  async function ensureAvailable(id) {
    const runtime = declaration(id);
    if (runtime.enabled !== true) throw new Error(`local_runtime_disabled:${id}`);
    const current = await probe(id);
    if (current.available) return current;
    if (owned.has(id)) throw new Error(`local_runtime_starting:${id}`);
    if (!runtime.command) throw new Error(`local_runtime_unavailable:${id}`);
    const child = spawnProcess(runtime.command, runtime.args ?? [], {
      cwd: runtime.cwd,
      env: { ...process.env, ...(runtime.env ?? {}) },
      windowsHide: true,
      stdio: 'ignore',
    });
    owned.set(id, child);
    child.once?.('exit', () => owned.delete(id));
    const deadline = Date.now() + startupTimeoutMs;
    while (Date.now() < deadline) {
      const next = await probe(id);
      if (next.available) return Object.freeze({ ...next, owned: true });
      await delay(Math.min(100, Math.max(1, deadline - Date.now())));
    }
    child.kill?.('SIGTERM');
    owned.delete(id);
    throw new Error(`local_runtime_start_timeout:${id}`);
  }

  function status(id) {
    declaration(id);
    return states.get(id) ?? Object.freeze({ id, available: false, reason: 'not_probed', owned: owned.has(id) });
  }

  async function stopOwned() {
    for (const [id, child] of [...owned]) {
      const exited = once(child, 'exit').then(() => true).catch(() => false);
      child.kill?.('SIGTERM');
      const graceful = await Promise.race([exited, delay(shutdownTimeoutMs).then(() => false)]);
      if (!graceful) child.kill?.('SIGKILL');
      owned.delete(id);
      states.set(id, Object.freeze({ id, available: false, reason: 'stopped', owned: false }));
    }
    return Object.freeze({ stopped: true });
  }

  return Object.freeze({ probe, ensureAvailable, status, stopOwned });
}
