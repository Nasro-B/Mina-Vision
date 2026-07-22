import { validateProbes } from './health-probes.mjs';

const DEFAULT_CONCURRENCY = 4;
const DEFAULT_TIMEOUT_MS = 3000;
const DEFAULT_HISTORY_SIZE = 20;

function withTimeout(promise, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`health_probe_timeout after ${timeoutMs}ms`)), timeoutMs);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

async function runWithConcurrency(items, limit, fn) {
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const current = nextIndex;
      nextIndex += 1;
      // eslint-disable-next-line no-await-in-loop
      await fn(items[current]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
}

export function createHealthMonitor({
  probes, clock, concurrency = DEFAULT_CONCURRENCY, timeoutMs = DEFAULT_TIMEOUT_MS, historySize = DEFAULT_HISTORY_SIZE,
} = {}) {
  validateProbes(probes);
  if (!clock || (typeof clock !== 'function' && typeof clock.now !== 'function')) {
    throw new TypeError('health_monitor_clock_required');
  }
  const now = () => Number(typeof clock === 'function' ? clock() : clock.now());
  const history = new Map(probes.map((probe) => [probe.id, []]));
  let intervalHandle = null;

  async function probeOnce(probe) {
    const controller = new AbortController();
    let entry;
    try {
      const value = await withTimeout(probe.read(controller.signal), timeoutMs);
      entry = {
        probeId: probe.id, resourceId: probe.resourceId, status: 'ok',
        value, error: null, suggestion: null, observedAt: now(),
      };
    } catch (error) {
      controller.abort();
      entry = {
        probeId: probe.id, resourceId: probe.resourceId, status: 'failed',
        value: null, error: error.message,
        suggestion: `Vérifier manuellement la ressource "${probe.resourceId}" (sonde "${probe.id}").`,
        observedAt: now(),
      };
    }
    const entries = history.get(probe.id);
    entries.push(entry);
    if (entries.length > historySize) entries.splice(0, entries.length - historySize);
  }

  async function runOnce() {
    await runWithConcurrency(probes, concurrency, probeOnce);
  }

  function stop() {
    if (intervalHandle) {
      clearInterval(intervalHandle);
      intervalHandle = null;
    }
  }

  function startSchedule(intervalMs) {
    stop();
    intervalHandle = setInterval(() => { runOnce(); }, intervalMs);
  }

  function snapshot() {
    return probes.flatMap((probe) => history.get(probe.id));
  }

  return Object.freeze({ runOnce, startSchedule, stop, snapshot });
}
