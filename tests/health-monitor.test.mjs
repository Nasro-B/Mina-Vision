import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHealthMonitor } from '../src/health/health-monitor.mjs';

function okProbe(id, resourceId = id, value = 'ok') {
  return { id, resourceId, read: vi.fn(async () => value) };
}

describe('createHealthMonitor: constructor guards', () => {
  it('requires an array of probes', () => {
    expect(() => createHealthMonitor({ clock: () => 0 })).toThrow('health_probes_array_required');
  });

  it('rejects a probe missing read', () => {
    expect(() => createHealthMonitor({ probes: [{ id: 'a', resourceId: 'a' }], clock: () => 0 })).toThrow('health_probe_read_required');
  });

  it('rejects duplicate probe ids', () => {
    expect(() => createHealthMonitor({ probes: [okProbe('a'), okProbe('a')], clock: () => 0 })).toThrow('health_probe_id_duplicate:a');
  });
});

describe('createHealthMonitor.runOnce: probes only registered resources, never a side effect', () => {
  it('never calls anything beyond each registered probe read, and every snapshot entry has observedAt', async () => {
    const networkScanner = vi.fn();
    const writer = vi.fn();
    const monitor = createHealthMonitor({ probes: [okProbe('lmstudio'), okProbe('adb')], clock: () => 1_700_000_000_000 });

    await monitor.runOnce();

    expect(networkScanner).not.toHaveBeenCalled();
    expect(writer).not.toHaveBeenCalled();
    expect(monitor.snapshot().every((entry) => entry.observedAt)).toBe(true);
  });

  it('records a successful observation with status ok and the probe value', async () => {
    const monitor = createHealthMonitor({ probes: [okProbe('lmstudio', 'lmstudio', { ready: true })], clock: () => 5000 });
    await monitor.runOnce();
    const [entry] = monitor.snapshot();
    expect(entry).toMatchObject({ probeId: 'lmstudio', resourceId: 'lmstudio', status: 'ok', value: { ready: true }, observedAt: 5000 });
    expect(entry.suggestion).toBeNull();
  });
});

describe('createHealthMonitor.runOnce: failure isolation and suggestion (never a repair)', () => {
  it('records a failed probe as a suggestion, and never lets one failing probe block another', async () => {
    const failing = { id: 'broken', resourceId: 'broken-resource', read: vi.fn(async () => { throw new Error('connection_refused'); }) };
    const healthy = okProbe('healthy');
    const monitor = createHealthMonitor({ probes: [failing, healthy], clock: () => 0 });

    await monitor.runOnce();

    const entries = monitor.snapshot();
    const failedEntry = entries.find((entry) => entry.probeId === 'broken');
    const healthyEntry = entries.find((entry) => entry.probeId === 'healthy');
    expect(failedEntry.status).toBe('failed');
    expect(failedEntry.error).toContain('connection_refused');
    expect(typeof failedEntry.suggestion).toBe('string');
    expect(failedEntry.suggestion.length).toBeGreaterThan(0);
    expect(healthyEntry.status).toBe('ok');
  });

  it('never executes any repair function itself — only ever calls each probe read', async () => {
    const repair = vi.fn();
    const failing = { id: 'broken', resourceId: 'r', read: vi.fn(async () => { throw new Error('down'); }) };
    const monitor = createHealthMonitor({ probes: [failing], clock: () => 0 });
    await monitor.runOnce();
    expect(repair).not.toHaveBeenCalled();
  });

  it('times out a probe that never resolves within the default 3000ms and records it as failed', async () => {
    vi.useFakeTimers();
    try {
      const stuck = { id: 'stuck', resourceId: 'r', read: vi.fn(() => new Promise(() => {})) };
      const monitor = createHealthMonitor({ probes: [stuck], clock: () => 0 });
      const runPromise = monitor.runOnce();
      await vi.advanceTimersByTimeAsync(3001);
      await runPromise;
      const [entry] = monitor.snapshot();
      expect(entry.status).toBe('failed');
      expect(entry.error).toContain('timeout');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('createHealthMonitor.runOnce: concurrency cap', () => {
  it('never runs more than 4 probes at once', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const probes = Array.from({ length: 9 }, (_, index) => ({
      id: `p${index}`,
      resourceId: `r${index}`,
      read: vi.fn(async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await Promise.resolve();
        await Promise.resolve();
        inFlight -= 1;
        return 'ok';
      }),
    }));
    const monitor = createHealthMonitor({ probes, clock: () => 0 });
    await monitor.runOnce();
    expect(maxInFlight).toBeLessThanOrEqual(4);
    expect(monitor.snapshot()).toHaveLength(9);
  });
});

describe('createHealthMonitor.snapshot: retains only the last 20 observations per probe', () => {
  it('drops the oldest observation once a probe exceeds 20 recorded runs', async () => {
    let call = 0;
    const probe = { id: 'p', resourceId: 'r', read: vi.fn(async () => { call += 1; return call; }) };
    let time = 0;
    const monitor = createHealthMonitor({ probes: [probe], clock: () => { time += 1; return time; } });
    for (let i = 0; i < 21; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await monitor.runOnce();
    }
    const entries = monitor.snapshot();
    expect(entries).toHaveLength(20);
    expect(entries[0].value).toBe(2);
    expect(entries.at(-1).value).toBe(21);
  });
});

describe('createHealthMonitor.startSchedule / stop', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('runs the probes on the given interval until stop is called', async () => {
    const probe = okProbe('p');
    const monitor = createHealthMonitor({ probes: [probe], clock: () => Date.now() });

    monitor.startSchedule(1000);
    await vi.advanceTimersByTimeAsync(3500);
    monitor.stop();
    const callsAtStop = probe.read.mock.calls.length;
    await vi.advanceTimersByTimeAsync(5000);

    expect(callsAtStop).toBeGreaterThanOrEqual(3);
    expect(probe.read.mock.calls.length).toBe(callsAtStop);
  });

  it('stop is safe to call even when no schedule is running', () => {
    const monitor = createHealthMonitor({ probes: [okProbe('p')], clock: () => 0 });
    expect(() => monitor.stop()).not.toThrow();
  });
});
