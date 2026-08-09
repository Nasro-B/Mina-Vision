import { describe, expect, it, vi } from 'vitest';
import {
  createLmStudioProvider, DEFAULT_LM_STUDIO_TIMEOUT_MS, MAX_LM_STUDIO_SSE_LINE_BYTES,
} from '../src/providers/lm-studio.mjs';

function sseResponse(text, cuts = []) {
  const bytes = new TextEncoder().encode(text);
  const boundaries = [...cuts, bytes.length];
  let offset = 0;
  const chunks = boundaries.map((end) => {
    const chunk = bytes.slice(offset, end);
    offset = end;
    return chunk;
  });
  return new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  }), { headers: { 'content-type': 'text/event-stream' } });
}

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

  it('lit les deltas SSE natifs dans l’ordre et attend leur consommateur durable', async () => {
    const stream = [
      ': commentaire café ignoré\r\n',
      'event: message\r\n',
      'data: {"model":"gemma-local","choices":[{"delta":{"content":"boné"}}]}\r\n\r\n',
      'id: 2\r\n',
      'data: {"choices":[{"delta":{"content":"jour"},"finish_reason":"stop"}],"usage":{"prompt_tokens":4,"completion_tokens":2,"total_tokens":6}}\r\n\r\n',
      'data: [DONE]\r\n\r\n',
    ].join('');
    const accentOffset = new TextEncoder().encode(stream.slice(0, stream.lastIndexOf('é'))).byteLength;
    const fetchImpl = vi.fn(async (url, options = {}) => {
      if (String(url).endsWith('/api/v1/models')) {
        return Response.json({ models: [{ key: 'gemma-local', type: 'llm', loaded_instances: [{ id: 'gemma-local' }] }] });
      }
      expect(JSON.parse(options.body)).toMatchObject({ model: 'gemma-local', stream: true });
      return sseResponse(stream, [17, accentOffset + 1, 151]);
    });
    const provider = createLmStudioProvider({ model: 'gemma-local', fetchImpl });
    const deltas = [];
    let releaseDelta;
    const deltaGate = new Promise((resolve) => { releaseDelta = resolve; });
    const onDelta = vi.fn(async (delta) => {
      deltas.push(delta);
      await deltaGate;
    });

    const pending = provider.generate({ messages: [{ role: 'user', content: 'bonjour' }], stream: true, onDelta });
    await vi.waitFor(() => expect(onDelta).toHaveBeenCalledTimes(1));
    let settled = false;
    void pending.then(() => { settled = true; });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(settled).toBe(false);
    releaseDelta();

    await expect(pending).resolves.toMatchObject({
      output: 'bonéjour', providerId: 'lm-studio', modelId: 'gemma-local', finishReason: 'stop',
      usage: { inputTokens: 4, outputTokens: 2, totalTokens: 6, completeness: 'final' },
    });
    expect(deltas).toEqual(['boné', 'jour']);
  });

  it('maintient le délai pendant tout le flux SSE et borne une ligne non terminée', async () => {
    const fetchImpl = vi.fn(async (url, options = {}) => {
      if (String(url).endsWith('/api/v1/models')) {
        return Response.json({ models: [{ key: 'gemma-local', type: 'llm', loaded_instances: [{ id: 'gemma-local' }] }] });
      }
      return new Response(new ReadableStream({
        start(controller) {
          options.signal.addEventListener('abort', () => controller.error(new Error('aborted')), { once: true });
        },
      }), { headers: { 'content-type': 'text/event-stream' } });
    });
    const provider = createLmStudioProvider({ model: 'gemma-local', fetchImpl, timeoutMs: 20 });
    await expect(provider.generate({ messages: [], stream: true })).rejects.toThrow('local_runtime_timeout');

    const oversized = createLmStudioProvider({
      model: 'gemma-local',
      fetchImpl: async (url) => (String(url).endsWith('/api/v1/models')
        ? Response.json({ models: [{ key: 'gemma-local', type: 'llm', loaded_instances: [{ id: 'gemma-local' }] }] })
        : sseResponse(`data: ${'x'.repeat(MAX_LM_STUDIO_SSE_LINE_BYTES + 1)}`)),
    });
    await expect(oversized.generate({ messages: [], stream: true })).rejects.toThrow('lm_studio_stream_line_too_long');
  });

  it('propage une annulation externe pendant la lecture SSE', async () => {
    const fetchImpl = vi.fn(async (url, options = {}) => {
      if (String(url).endsWith('/api/v1/models')) {
        return Response.json({ models: [{ key: 'gemma-local', type: 'llm', loaded_instances: [{ id: 'gemma-local' }] }] });
      }
      return new Response(new ReadableStream({
        start(controller) {
          options.signal.addEventListener('abort', () => controller.error(new Error('aborted')), { once: true });
        },
      }), { headers: { 'content-type': 'text/event-stream' } });
    });
    const provider = createLmStudioProvider({ model: 'gemma-local', fetchImpl });
    const controller = new AbortController();
    const pending = provider.generate({ messages: [], stream: true, signal: controller.signal });
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
    controller.abort();

    await expect(pending).rejects.toThrow('local_runtime_aborted');
  });
});
