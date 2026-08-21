import { describe, expect, it, vi } from 'vitest';
import { createBrowserExecutor } from '../src/executors/browser-executor.mjs';
import { createBrowserPerformanceTracer } from '../src/diagnostics/browser-performance-tracer.mjs';

function createBrowserFake() {
  const page = {
    screenshot: vi.fn(async () => Buffer.from('png')),
    viewportSize: vi.fn(() => ({ width: 1_440, height: 900 })),
    title: vi.fn(async () => 'Fixture'),
    url: vi.fn(() => 'https://example.com/secret-path?q=motdepasse'),
    evaluate: vi.fn(async () => true),
    goto: vi.fn(), goBack: vi.fn(), goForward: vi.fn(),
    waitForTimeout: vi.fn(),
    mouse: { click: vi.fn(), move: vi.fn(), down: vi.fn(), up: vi.fn(), wheel: vi.fn() },
    keyboard: { insertText: vi.fn(), press: vi.fn(), down: vi.fn(), up: vi.fn() },
  };
  const context = { pages: vi.fn(() => [page]), newPage: vi.fn(async () => page), on: vi.fn(), close: vi.fn() };
  return { page, context, launchContext: vi.fn(async () => context) };
}

function tickingClock() {
  let t = 0;
  return () => { t += 5; return t; };
}

describe('browser-executor observabilité (lecture seule, §8.4)', () => {
  it('sans traceur (défaut) : aucune mesure, comportement inchangé', async () => {
    const fake = createBrowserFake();
    const executor = await createBrowserExecutor({ launchContext: fake.launchContext });
    await expect(executor.execute({ name: 'click', x: 10, y: 20 })).resolves.toMatchObject({ executed: true });
    // Rien à mesurer : pas de traceur, donc pas de fuite d'état ni d'erreur.
  });

  it('avec traceur : enregistre une latence par action (phase playwright, voie fast), statut ok', async () => {
    const fake = createBrowserFake();
    const tracer = createBrowserPerformanceTracer();
    const executor = await createBrowserExecutor({ launchContext: fake.launchContext, tracer, now: tickingClock() });

    await executor.execute({ name: 'click', x: 10, y: 20 });
    await executor.execute({ name: 'navigate', url: 'https://example.com/' });

    expect(tracer.size()).toBe(2);
    expect(tracer.summary({ phase: 'playwright' }).count).toBe(2);
    const [span] = tracer.spans();
    expect(span).toMatchObject({ phase: 'playwright', route: 'fast', status: 'ok' });
    expect(span.durationMs).toBeGreaterThan(0);
  });

  it('une action qui échoue est tracée avec le statut error (jamais silencieuse)', async () => {
    const fake = createBrowserFake();
    fake.page.evaluate = vi.fn(async () => false); // aucun champ éditable focalisé → type refusé
    const tracer = createBrowserPerformanceTracer();
    const executor = await createBrowserExecutor({ launchContext: fake.launchContext, tracer, now: tickingClock() });

    await expect(executor.execute({ name: 'type', text: 'motdepasse-secret', pressEnter: true }))
      .rejects.toThrow('browser_text_target_not_focused');
    expect(tracer.summary().failures).toBe(1);
  });

  it('confidentialité : aucun span ne contient le texte saisi, l’URL complète ni le DOM (§8.4)', async () => {
    const fake = createBrowserFake();
    const tracer = createBrowserPerformanceTracer();
    const executor = await createBrowserExecutor({ launchContext: fake.launchContext, tracer, now: tickingClock() });

    fake.page.evaluate = vi.fn(async () => true);
    await executor.execute({ name: 'type', text: 'motdepasse-secret', x: 10, y: 20 });
    await executor.execute({ name: 'navigate', url: 'https://example.com/secret-path?q=motdepasse' });

    const blob = JSON.stringify(tracer.spans());
    expect(blob).not.toContain('motdepasse');
    expect(blob).not.toContain('secret-path');
  });
});
