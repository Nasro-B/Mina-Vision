import { describe, expect, it, vi } from 'vitest';
import { createLmStudioProvider, DEFAULT_LM_STUDIO_TIMEOUT_MS } from '../src/providers/lm-studio.mjs';

describe('LM Studio provider', () => {
  it('uses a local-model timeout compatible with reasoning models and honors cancellation', async () => {
    expect(DEFAULT_LM_STUDIO_TIMEOUT_MS).toBe(240_000);
    const controller = new AbortController();
    controller.abort();
    const provider = createLmStudioProvider({
      model: 'qwen', fetchImpl: async () => Response.json({ data: [{ id: 'qwen' }] }),
    });
    await expect(provider.generate({ messages: [], signal: controller.signal }))
      .rejects.toThrow('local_runtime_aborted');
  });

  it('checks the configured model and returns standardized actual usage', async () => {
    const fetchImpl = vi.fn(async (url, options = {}) => {
      if (String(url).endsWith('/api/v1/models')) {
        return Response.json({
          models: [{ key: 'qwen-7b-local', type: 'llm', loaded_instances: [{ id: 'qwen-7b-local' }] }],
        });
      }
      expect(options.method).toBe('POST');
      return Response.json({
        model: 'qwen-7b-local', choices: [{ message: { content: 'Bonjour local' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 },
      });
    });
    const provider = createLmStudioProvider({ model: 'qwen-7b-local', fetchImpl });

    await expect(provider.generate({ messages: [{ role: 'user', content: 'Salut' }] })).resolves.toMatchObject({
      output: 'Bonjour local', providerId: 'lm-studio', modelId: 'qwen-7b-local',
      usage: { inputTokens: 12, outputTokens: 4, totalTokens: 16 },
    });
    expect(await provider.probe()).toMatchObject({ available: true, models: ['qwen-7b-local'] });
  });

  it('reports an installed but unloaded model unavailable before generation', async () => {
    const fetchImpl = vi.fn(async (url) => {
      if (String(url).endsWith('/api/v1/models')) {
        return Response.json({
          models: [{ key: 'gemma-local', type: 'llm', loaded_instances: [] }],
        });
      }
      if (String(url).endsWith('/v1/models')) return Response.json({ data: [{ id: 'gemma-local' }] });
      throw new Error(`unexpected_url:${url}`);
    });
    const provider = createLmStudioProvider({ model: 'gemma-local', fetchImpl });

    await expect(provider.probe()).resolves.toEqual({
      available: false,
      reason: 'local_model_unavailable:gemma-local',
    });
  });

  it('rejects a wrong model and normalizes connection refusal without cloud fallback', async () => {
    const wrong = createLmStudioProvider({
      model: 'missing-model',
      fetchImpl: async () => Response.json({
        models: [{ key: 'other', type: 'llm', loaded_instances: [{ id: 'other' }] }],
      }),
    });
    await expect(wrong.generate({ messages: [] })).rejects.toThrow('local_model_unavailable:missing-model');

    const closed = createLmStudioProvider({ model: 'qwen', fetchImpl: async () => { throw new TypeError('fetch failed'); } });
    await expect(closed.generate({ messages: [] })).rejects.toThrow('local_runtime_unavailable');
    expect(closed.health()).toMatchObject({ available: false });
  });
});
