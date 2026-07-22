import { describe, expect, it, vi } from 'vitest';
import { createBrowserExecutor } from '../src/executors/browser-executor.mjs';

describe('structured browser observation', () => {
  it('keeps mission observations screenshot-only and serves DOM/accessibility through explicit inspect operations', async () => {
    const page = {
      screenshot: async () => Buffer.from('png'), viewportSize: () => ({ width: 800, height: 600 }),
      url: () => 'https://example.test/', title: async () => 'Fixture',
      mouse: {}, keyboard: {},
    };
    const context = { pages: () => [page], close: vi.fn() };
    const observer = {
      observe: vi.fn(async () => ({ title: 'Fixture', visibleText: 'Bonjour', accessibility: '- heading' })),
      inspect: vi.fn(async (operation) => ({ kind: operation, content: 'preuve' })),
    };
    const executor = await createBrowserExecutor({
      launchContext: async () => context,
      webObserverFactory: () => observer,
    });

    // The heavy structured payload is on-demand only: computing it on every observe() doubled the
    // per-turn mission latency for data the computer-use model never receives.
    const observation = await executor.observe();
    expect(observation.imageBase64).toBe(Buffer.from('png').toString('base64'));
    expect(observation.web).toBeUndefined();
    expect(observer.observe).not.toHaveBeenCalled();
    await expect(executor.execute({ name: 'inspect_dom' })).resolves.toMatchObject({
      executed: true, inspection: { kind: 'inspect_dom', content: 'preuve' },
    });
    expect(observer.inspect).toHaveBeenCalledWith('inspect_dom', { sourceAuthorized: false });
  });
});
