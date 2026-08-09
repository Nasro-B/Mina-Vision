import { describe, expect, it, vi } from 'vitest';
import { createDeepSeekProvider } from '../src/providers/deepseek.mjs';

function client(response) {
  return { chat: { completions: { create: vi.fn(async () => response) } } };
}

describe('DeepSeek v4 provider', () => {
  it('returns standardized non-stream output and preserves raw usage', async () => {
    const fake = client({
      model: 'deepseek-v4-pro',
      choices: [{ message: { content: 'Bonjour' }, finish_reason: 'stop' }],
      usage: {
        prompt_tokens: 20, completion_tokens: 8, prompt_cache_hit_tokens: 5,
        completion_tokens_details: { reasoning_tokens: 3 },
      },
    });
    const provider = createDeepSeekProvider({
      apiKeyProvider: async () => 'secret', model: 'deepseek-v4-pro', clientFactory: () => fake,
    });

    const result = await provider.generate({ messages: [{ role: 'user', content: 'Salut' }], thinking: true });
    expect(result).toMatchObject({
      output: 'Bonjour', providerId: 'deepseek', modelId: 'deepseek-v4-pro', finishReason: 'stop',
      usage: { inputTokens: 20, outputTokens: 8, cachedInputTokens: 5, reasoningTokens: 3, completeness: 'final' },
    });
    expect(result.rawUsage.prompt_tokens).toBe(20);
    expect(fake.chat.completions.create).toHaveBeenCalledWith(expect.objectContaining({
      model: 'deepseek-v4-pro', thinking: { type: 'enabled' }, stream: false,
    }), expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it('streams deltas in real time and keeps final usage', async () => {
    async function* stream() {
      yield { choices: [{ delta: { content: 'Bon' }, finish_reason: null }] };
      yield { choices: [{ delta: { content: 'jour' }, finish_reason: 'stop' }], usage: { prompt_tokens: 4, completion_tokens: 2 } };
    }
    const fake = client(stream());
    const onDelta = vi.fn();
    const provider = createDeepSeekProvider({ apiKeyProvider: async () => 'secret', clientFactory: () => fake });

    await expect(provider.generate({ messages: [], stream: true, onDelta })).resolves.toMatchObject({
      output: 'Bonjour', finishReason: 'stop', usage: { inputTokens: 4, outputTokens: 2, completeness: 'final' },
    });
    expect(onDelta.mock.calls.map(([delta]) => delta)).toEqual(['Bon', 'jour']);
  });

  it('attend le consommateur de delta avant de terminer le stream', async () => {
    async function* stream() {
      yield { choices: [{ delta: { content: 'Bon' }, finish_reason: 'stop' }] };
    }
    const fake = client(stream());
    const provider = createDeepSeekProvider({ apiKeyProvider: async () => 'secret', clientFactory: () => fake });
    let releaseDelta;
    const gate = new Promise((resolve) => { releaseDelta = resolve; });
    const onDelta = vi.fn(async () => { await gate; });

    const pending = provider.generate({ messages: [], stream: true, onDelta });
    await vi.waitFor(() => expect(onDelta).toHaveBeenCalledTimes(1));
    let settled = false;
    void pending.then(() => { settled = true; });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(settled).toBe(false);
    releaseDelta();
    await expect(pending).resolves.toMatchObject({ output: 'Bon', finishReason: 'stop' });
  });

  it('normalizes timeout and authentication failures', async () => {
    const timeoutClient = client(new Promise((_resolve, reject) => {
      setTimeout(() => reject(new Error('late')), 100);
    }));
    const timeoutProvider = createDeepSeekProvider({
      apiKeyProvider: async () => 'secret', clientFactory: () => timeoutClient, timeoutMs: 5,
    });
    await expect(timeoutProvider.generate({ messages: [] })).rejects.toThrow('deepseek_timeout');

    const unauthorized = Object.assign(new Error('Unauthorized'), { status: 401 });
    const authProvider = createDeepSeekProvider({
      apiKeyProvider: async () => 'secret', clientFactory: () => client(Promise.reject(unauthorized)),
    });
    await expect(authProvider.generate({ messages: [] })).rejects.toThrow('deepseek_auth_failed');
  });

  it('warns for legacy aliases before the deadline and rejects them afterwards', async () => {
    const warnings = [];
    const before = createDeepSeekProvider({
      apiKeyProvider: async () => 'secret', model: 'deepseek-chat',
      clock: () => Date.parse('2026-07-15T00:00:00Z'), onEvent: (event) => warnings.push(event),
      clientFactory: () => client({ model: 'deepseek-chat', choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] }),
    });
    await before.generate({ messages: [] });
    expect(warnings).toContainEqual(expect.objectContaining({ type: 'provider_model_deprecated', modelId: 'deepseek-chat' }));

    expect(() => createDeepSeekProvider({
      apiKeyProvider: async () => 'secret', model: 'deepseek-reasoner',
      clock: () => Date.parse('2026-07-25T00:00:00Z'), clientFactory: () => client({}),
    })).toThrow('deepseek_model_deprecated');
  });
});
