import { describe, expect, it } from 'vitest';
import { createBrowserPerformanceTracer } from '../src/diagnostics/browser-performance-tracer.mjs';

describe('browser-performance-tracer', () => {
  it('calcule p50, p95, max, timeouts et fallbacks par phase/voie', () => {
    const tracer = createBrowserPerformanceTracer();
    for (const d of [10, 20, 30, 40, 100]) tracer.record({ commandId: 'c', route: 'fast', phase: 'goto', durationMs: d });
    tracer.record({ commandId: 'c', route: 'fast', phase: 'goto', durationMs: 999, timeout: true });
    tracer.record({ commandId: 'c', route: 'vision', phase: 'model', durationMs: 5, fallback: true });

    const goto = tracer.summary({ phase: 'goto' });
    expect(goto.count).toBe(6);
    expect(goto.max).toBe(999);
    expect(goto.p50).toBeGreaterThan(0);
    expect(goto.p95).toBeGreaterThanOrEqual(goto.p50);
    expect(goto.timeouts).toBe(1);

    expect(tracer.summary({ route: 'vision' }).fallbacks).toBe(1);
    expect(Object.keys(tracer.byPhase())).toEqual(expect.arrayContaining(['goto', 'model']));
  });

  it('ne conserve JAMAIS requête, URL complète ni capture (seulement origine + nombres)', () => {
    const tracer = createBrowserPerformanceTracer();
    tracer.record({ commandId: 'c', route: 'fast', phase: 'goto', durationMs: 12, url: 'https://secret.test/p?token=XYZ' });
    const serialized = JSON.stringify(tracer.spans());
    expect(serialized).not.toContain('token=XYZ');
    expect(serialized).not.toContain('/p?');
    expect(serialized).toContain('https://secret.test'); // origine seulement
  });

  it('borne la mémoire (ring)', () => {
    const tracer = createBrowserPerformanceTracer({ maxSpans: 50 });
    for (let i = 0; i < 500; i += 1) tracer.record({ commandId: 'c', route: 'fast', phase: 'x', durationMs: i });
    expect(tracer.size()).toBe(50);
  });

  it('reset vide les spans', () => {
    const tracer = createBrowserPerformanceTracer();
    tracer.record({ commandId: 'c', route: 'fast', phase: 'x', durationMs: 1 });
    tracer.reset();
    expect(tracer.size()).toBe(0);
    expect(tracer.summary().count).toBe(0);
  });
});
