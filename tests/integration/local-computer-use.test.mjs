import { readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { createMinaOrchestrator } from '../../src/core/orchestrator.mjs';
import { createBrowserExecutor } from '../../src/executors/browser-executor.mjs';
import { createInferenceModePolicy } from '../../src/routing/inference-mode-policy.mjs';
import { createCapabilityRouter } from '../../src/routing/capability-router.mjs';
import { createProviderRegistry } from '../../src/providers/provider-registry.mjs';
import { createLocalComputerUseProvider } from '../../src/providers/local-computer-use.mjs';
import { createRoutedComputerUse } from '../../src/providers/routed-computer-use.mjs';

const fixtureUrl = new URL('../fixtures/control-page.html', import.meta.url);

describe('local-only Computer Use integration', () => {
  it('uses the existing browser loop to focus and type a local search without a cloud provider', async () => {
    const html = await readFile(fixtureUrl);
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(html);
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const { port } = server.address();
    const profileDir = `G:\\MinaTests\\local-cu-${process.pid}`;
    const executor = await createBrowserExecutor({ profileDir });
    const outputs = [
      JSON.stringify({
        completed: false,
        action: { name: 'click', arguments: { x: 100, y: 20, intent: 'Focus search' } },
        expectedEffect: { type: 'ui_state_change' },
      }),
      JSON.stringify({
        completed: false,
        action: { name: 'type', arguments: { text: 'recette de gâteau', intent: 'Enter search' } },
        expectedEffect: { type: 'ui_state_change' },
      }),
      JSON.stringify({ completed: true, text: 'Recherche saisie et vérifiée.' }),
    ];
    const plan = vi.fn(async () => outputs.shift());
    const local = createLocalComputerUseProvider({
      modelRegistry: { resolve: () => ({ id: 'fixture-local-cu' }) },
      modelLoader: { load: async () => ({ plan }) },
      idFactory: () => 'local-integration-1',
    });
    const cloudInvoke = vi.fn(async () => { throw new Error('cloud_must_not_run'); });
    const registry = createProviderRegistry();
    registry.register(local);
    registry.register({
      id: 'cloud-cu', locality: 'cloud', network: 'internet', capabilities: ['computer.use'],
      health: () => ({ available: true }), invoke: cloudInvoke,
    });
    const router = createCapabilityRouter({ providerRegistry: registry, modePolicy: createInferenceModePolicy() });
    const computerUse = createRoutedComputerUse({ capabilityRouter: router, providerRegistry: registry });
    const mina = createMinaOrchestrator({ computerUse, executors: { browser: executor } });

    try {
      await executor.execute({ name: 'navigate', url: `http://127.0.0.1:${port}/` });
      const state = await mina.run({
        goal: 'Ouvre la page locale et cherche recette de gâteau',
        environment: 'browser',
        mode: 'local-only',
        maxActions: 5,
        timeoutMs: 60_000,
      });

      expect(state).toMatchObject({ status: 'completed', actionCount: 2 });
      expect(await executor.getPage().locator('#text').inputValue()).toBe('recette de gâteau');
      const visibleText = await executor.execute({ name: 'read_visible_text', sourceAuthorized: true });
      expect(visibleText.inspection.content).toContain('Texte à sélectionner par Mina');
      expect(cloudInvoke).not.toHaveBeenCalled();
    } finally {
      await executor.close();
      server.close();
      await rm(profileDir, { recursive: true, force: true });
    }
  }, 90_000);
});
