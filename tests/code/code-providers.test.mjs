import { describe, expect, it } from 'vitest';
import { buildCodeMessages, createCodeProviderAdapter, extractMinaPatch } from '../../src/code/providers/code-adapter-core.mjs';
import { createDeepSeekCoder } from '../../src/code/providers/deepseek-coder.mjs';
import { createGeminiCode } from '../../src/code/providers/gemini-code.mjs';
import { createOpenRouterCode } from '../../src/code/providers/openrouter-code.mjs';
import { createLmStudioCode } from '../../src/code/providers/lmstudio-code.mjs';
import { createCodeProviderRouter } from '../../src/code/providers/code-provider-router.mjs';
import { createProviderRegistry } from '../../src/providers/provider-registry.mjs';

const PATCH = '*** Begin Patch\n*** Update File: a.mjs\n-x\n+y\n*** End Patch';

function fakeBaseProvider({ id = 'deepseek', locality = 'cloud', network = 'internet', modelId = 'deepseek-v4-flash', output = `Voici :\n${PATCH}\nFin.` } = {}) {
  const invocations = [];
  return {
    id,
    locality,
    network,
    modelId,
    capabilities: ['text.generate'],
    invocations,
    health: () => ({ available: true }),
    invoke: async (input) => {
      invocations.push(input);
      return { output, providerId: id, modelId, usage: { inputTokens: 100, outputTokens: 50 }, finishReason: 'stop' };
    },
  };
}

describe('code-adapter-core', () => {
  it('extractMinaPatch isole le bloc patch, null sinon', () => {
    expect(extractMinaPatch(`bla\n${PATCH}\nsuite`)).toBe(PATCH);
    expect(extractMinaPatch('aucun patch ici')).toBeNull();
    expect(extractMinaPatch('*** Begin Patch sans fin')).toBeNull();
  });

  it('buildCodeMessages : système outillé format Mina + fichiers bornés', () => {
    const messages = buildCodeMessages({
      task: 'corrige le bug',
      systemPrompt: 'Tu es Mina Code.',
      context: 'framework: Electron',
      files: [{ path: 'a.mjs', content: 'const x = 1;' }],
    });
    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toContain('*** Begin Patch');
    expect(messages[0].content).toContain('Jamais de git push');
    expect(messages[1].content).toContain('corrige le bug');
    expect(messages[1].content).toContain('framework: Electron');
    expect(messages[1].content).toContain('Fichier a.mjs');
    expect(() => buildCodeMessages({})).toThrow(/task_required/u);
  });

  it('adapte le contrat registry : id suffixé, capacité code.generate, health délégué', async () => {
    const base = fakeBaseProvider();
    const adapter = createCodeProviderAdapter({ baseProvider: base });
    expect(adapter.id).toBe('deepseek-code');
    expect(adapter.capabilities).toEqual(['code.generate']);
    expect(adapter.locality).toBe('cloud');
    expect(adapter.health()).toEqual({ available: true });

    const result = await adapter.generateCode({ task: 'fais un patch' });
    expect(result.patch).toBe(PATCH);
    expect(result.usage).toEqual({ inputTokens: 100, outputTokens: 50 });
    expect(base.invocations[0].messages).toHaveLength(2);
  });

  it('sortie sans patch → patch null (le modèle a répondu en prose)', async () => {
    const adapter = createCodeProviderAdapter({ baseProvider: fakeBaseProvider({ output: 'Je ne sais pas.' }) });
    const result = await adapter.generateCode({ task: 'question' });
    expect(result.patch).toBeNull();
    expect(result.output).toBe('Je ne sais pas.');
  });
});

describe('adaptateurs spécifiques', () => {
  it('deepseek-coder exige le provider deepseek de base', () => {
    expect(() => createDeepSeekCoder({ baseProvider: fakeBaseProvider({ id: 'gemini-text' }) }))
      .toThrow(/deepseek_coder_base_provider_invalid/u);
    expect(createDeepSeekCoder({ baseProvider: fakeBaseProvider() }).id).toBe('deepseek-code');
  });

  it('gemini-code exige un provider gemini*', () => {
    expect(() => createGeminiCode({ baseProvider: fakeBaseProvider() })).toThrow(/gemini_code_base_provider_invalid/u);
    expect(createGeminiCode({ baseProvider: fakeBaseProvider({ id: 'gemini-text', modelId: 'gemini-3.5-flash' }) }).id)
      .toBe('gemini-text-code');
  });

  it('lmstudio-code exige un provider LOCAL', () => {
    expect(() => createLmStudioCode({ baseProvider: fakeBaseProvider() })).toThrow(/lmstudio_code_base_provider_invalid/u);
    const local = createLmStudioCode({
      baseProvider: fakeBaseProvider({ id: 'lm-studio', locality: 'local', network: 'loopback', modelId: 'qwen-local' }),
    });
    expect(local.locality).toBe('local');
  });

  it('openrouter-code accepte tout provider invocable', () => {
    expect(() => createOpenRouterCode({})).toThrow(/openrouter_code_base_provider_invalid/u);
    expect(createOpenRouterCode({ baseProvider: fakeBaseProvider({ id: 'openai-compatible' }) }).id)
      .toBe('openai-compatible-code');
  });
});

const PRICING_ROWS = [
  { providerId: 'deepseek', modelId: 'deepseek-v4-flash', revision: 'deepseek-v4-2026-07-15', unitPrices: { inputTokensPerMillion: '0.14', outputTokensPerMillion: '0.28' } },
  { providerId: 'gemini', modelId: 'gemini-3.5-flash', revision: 'google-2026-07-09', unitPrices: { inputTokensPerMillion: '1.50', outputTokensPerMillion: '9.00' } },
];

function buildRegistry({ withLocal = true, withCloud = true, healthOverrides = {} } = {}) {
  const registry = createProviderRegistry();
  const register = (provider) => registry.register(provider);
  if (withCloud) {
    register({
      id: 'deepseek-code', locality: 'cloud', network: 'internet', modelId: 'deepseek-v4-flash',
      capabilities: ['code.generate'],
      health: () => ({ available: healthOverrides['deepseek-code'] ?? true }),
      invoke: async () => ({ output: 'ok' }),
    });
    register({
      id: 'gemini-code', locality: 'cloud', network: 'internet', modelId: 'gemini-3.5-flash',
      capabilities: ['code.generate'],
      health: () => ({ available: healthOverrides['gemini-code'] ?? true }),
      invoke: async () => ({ output: 'ok' }),
    });
    register({
      id: 'openai-compatible-code', locality: 'cloud', network: 'internet', modelId: 'claude-sonnet',
      capabilities: ['code.generate'],
      health: () => ({ available: healthOverrides['openai-compatible-code'] ?? true }),
      invoke: async () => ({ output: 'ok' }),
    });
  }
  if (withLocal) {
    register({
      id: 'lm-studio-code', locality: 'local', network: 'loopback', modelId: 'qwen-local',
      capabilities: ['code.generate'],
      health: () => ({ available: healthOverrides['lm-studio-code'] ?? true }),
      invoke: async () => ({ output: 'ok' }),
    });
  }
  // Provider hors-code : ne doit JAMAIS être candidat.
  register({
    id: 'gemini-text', locality: 'cloud', network: 'internet', modelId: 'gemini-3.5-flash',
    capabilities: ['text.generate'],
    health: () => ({ available: true }),
    invoke: async () => ({ output: 'ok' }),
  });
  return registry;
}

describe('code-provider-router', () => {
  it('exige le registry et valide les modes', () => {
    expect(() => createCodeProviderRouter({})).toThrow(/registry_required/u);
    const router = createCodeProviderRouter({ providerRegistry: buildRegistry(), pricingRows: PRICING_ROWS });
    expect(() => router.setMode('yolo')).toThrow(/mode_invalid/u);
    expect(router.setMode('cheapest')).toBe('cheapest');
    expect(router.getMode()).toBe('cheapest');
  });

  it('ne considère que les providers code.generate en bonne santé', () => {
    const router = createCodeProviderRouter({
      providerRegistry: buildRegistry({ healthOverrides: { 'gemini-code': false } }),
      pricingRows: PRICING_ROWS,
    });
    const ids = router.listCandidates().map((entry) => entry.id);
    expect(ids).not.toContain('gemini-text');
    expect(ids).not.toContain('gemini-code');
    expect(ids).toContain('deepseek-code');
  });

  it('local-only : local sinon erreur offline nominée', () => {
    const withLocal = createCodeProviderRouter({ providerRegistry: buildRegistry(), pricingRows: PRICING_ROWS });
    expect(withLocal.route({ mode: 'local-only' }).providerId).toBe('lm-studio-code');
    const sansLocal = createCodeProviderRouter({ providerRegistry: buildRegistry({ withLocal: false }), pricingRows: PRICING_ROWS });
    expect(() => sansLocal.route({ mode: 'local-only' })).toThrow(/route_unavailable_offline/u);
  });

  it('local-first : local d\'abord, cloud le moins cher en repli', () => {
    const router = createCodeProviderRouter({ providerRegistry: buildRegistry(), pricingRows: PRICING_ROWS });
    expect(router.route({ mode: 'local-first' }).providerId).toBe('lm-studio-code');
    const sansLocal = createCodeProviderRouter({ providerRegistry: buildRegistry({ withLocal: false }), pricingRows: PRICING_ROWS });
    expect(sansLocal.route({ mode: 'local-first' }).providerId).toBe('deepseek-code');
  });

  it('cheapest : local gratuit gagne, prix réels du catalogue utilisés', () => {
    const router = createCodeProviderRouter({ providerRegistry: buildRegistry(), pricingRows: PRICING_ROWS });
    const route = router.route({ mode: 'cheapest' });
    expect(route.providerId).toBe('lm-studio-code');
    expect(route.pricing.combined).toBe(0);
    const cloud = createCodeProviderRouter({ providerRegistry: buildRegistry({ withLocal: false }), pricingRows: PRICING_ROWS });
    const cloudRoute = cloud.route({ mode: 'cheapest' });
    expect(cloudRoute.providerId).toBe('deepseek-code');
    expect(cloudRoute.pricing.combined).toBeCloseTo(0.42);
    expect(cloudRoute.pricing.revision).toBe('deepseek-v4-2026-07-15');
  });

  it('best-quality : suit l\'ordre de qualité (OpenRouter d\'abord)', () => {
    const router = createCodeProviderRouter({ providerRegistry: buildRegistry(), pricingRows: PRICING_ROWS });
    expect(router.route({ mode: 'best-quality' }).providerId).toBe('openai-compatible-code');
  });

  it('auto : local si dispo et tâche simple, cloud le moins cher si complexité high', () => {
    const router = createCodeProviderRouter({ providerRegistry: buildRegistry(), pricingRows: PRICING_ROWS });
    expect(router.route({ mode: 'auto' }).providerId).toBe('lm-studio-code');
    expect(router.route({ mode: 'auto', context: { complexity: 'high' } }).providerId).toBe('deepseek-code');
  });

  it('maxBudget : repli sous plafond ou erreur over_budget', () => {
    const cloud = createCodeProviderRouter({ providerRegistry: buildRegistry({ withLocal: false }), pricingRows: PRICING_ROWS });
    const capped = cloud.route({ mode: 'best-quality', maxBudget: 1 });
    expect(capped.providerId).toBe('deepseek-code');
    expect(capped.reason).toContain('budget');
    expect(() => cloud.route({ mode: 'cheapest', maxBudget: 0.1 })).toThrow(/route_over_budget/u);
  });

  it('aucun provider → erreur nominée', () => {
    const vide = createCodeProviderRouter({ providerRegistry: createProviderRegistry(), pricingRows: [] });
    expect(() => vide.route({})).toThrow(/route_unavailable/u);
  });
});
