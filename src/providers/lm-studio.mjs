import { TextDecoder } from 'node:util';

function usage(raw) {
  return Object.freeze({
    inputTokens: raw?.prompt_tokens ?? null,
    outputTokens: raw?.completion_tokens ?? null,
    totalTokens: raw?.total_tokens ?? null,
    completeness: raw?.prompt_tokens !== undefined && raw?.completion_tokens !== undefined ? 'final' : 'partial',
  });
}

export const DEFAULT_LM_STUDIO_TIMEOUT_MS = 240_000;
export const MAX_LM_STUDIO_SSE_LINE_BYTES = 64 * 1024;

function streamFailure(code) {
  throw new Error(code);
}

function decodeSseChunk(decoder, chunk, { stream } = {}) {
  try {
    return decoder.decode(chunk, { stream });
  } catch {
    streamFailure('lm_studio_stream_invalid');
  }
}

async function readOpenAiSse(response, { onDelta, signal } = {}) {
  if (!response.body?.getReader) streamFailure('lm_studio_stream_unavailable');
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  let pending = '';
  let done = false;
  let output = '';
  let modelId = null;
  let finishReason = null;
  let rawUsage = null;

  const consumeLine = async (rawLine) => {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (Buffer.byteLength(line, 'utf8') > MAX_LM_STUDIO_SSE_LINE_BYTES) {
      streamFailure('lm_studio_stream_line_too_long');
    }
    if (!line.startsWith('data:')) return;
    const data = line.slice('data:'.length).replace(/^ /u, '');
    if (data === '[DONE]') {
      done = true;
      return;
    }
    if (!data) return;

    let event;
    try {
      event = JSON.parse(data);
    } catch {
      streamFailure('lm_studio_stream_invalid');
    }
    const choice = event?.choices?.[0];
    const delta = choice?.delta?.content;
    if (typeof delta === 'string' && delta.length > 0) {
      output += delta;
      await onDelta?.(delta);
    }
    if (typeof event?.model === 'string' && event.model) modelId = event.model;
    if (choice?.finish_reason !== undefined && choice.finish_reason !== null) finishReason = choice.finish_reason;
    if (event?.usage && typeof event.usage === 'object' && !Array.isArray(event.usage)) rawUsage = event.usage;
  };

  const drain = async () => {
    let lineEnd = pending.indexOf('\n');
    while (lineEnd >= 0) {
      const line = pending.slice(0, lineEnd);
      pending = pending.slice(lineEnd + 1);
      await consumeLine(line);
      if (done) return;
      lineEnd = pending.indexOf('\n');
    }
    if (Buffer.byteLength(pending, 'utf8') > MAX_LM_STUDIO_SSE_LINE_BYTES) {
      streamFailure('lm_studio_stream_line_too_long');
    }
  };

  try {
    while (!done) {
      let read;
      try {
        read = await reader.read();
      } catch (error) {
        if (signal?.aborted) throw error;
        throw new Error('local_runtime_unavailable');
      }
      if (read.done) break;
      pending += decodeSseChunk(decoder, read.value, { stream: true });
      await drain();
    }
    if (!done) {
      pending += decodeSseChunk(decoder, undefined, { stream: false });
      await drain();
      if (pending) await consumeLine(pending);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }

  return Object.freeze({ output, modelId, finishReason, rawUsage });
}

export function createLmStudioProvider({
  baseURL = 'http://127.0.0.1:1234/v1',
  model,
  fetchImpl = fetch,
  timeoutMs = DEFAULT_LM_STUDIO_TIMEOUT_MS,
} = {}) {
  if (!model) throw new TypeError('lm_studio_model_required');
  const root = baseURL.replace(/\/$/u, '');
  const nativeModelsUrl = new URL('/api/v1/models', `${root}/`).href;
  let lastHealth = Object.freeze({ available: false, reason: 'not_probed' });

  async function request(url, options = {}, externalSignal) {
    if (externalSignal?.aborted) throw new Error('local_runtime_aborted');
    const controller = new AbortController();
    const signal = externalSignal
      ? AbortSignal.any([controller.signal, externalSignal])
      : controller.signal;
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error('local_runtime_timeout'));
      }, timeoutMs);
      timer.unref?.();
    });
    try {
      return await Promise.race([fetchImpl(url, { ...options, signal }), timeout]);
    } catch (error) {
      if (error.message === 'local_runtime_timeout') throw error;
      if (externalSignal?.aborted) throw new Error('local_runtime_aborted');
      throw new Error('local_runtime_unavailable');
    } finally {
      clearTimeout(timer);
    }
  }

  async function probe({ signal } = {}) {
    try {
      const response = await request(nativeModelsUrl, {}, signal);
      if (!response.ok) throw new Error(`http_${response.status}`);
      const body = await response.json();
      const models = (body.models ?? [])
        .filter(({ key, type, loaded_instances: instances }) => key && type === 'llm' && Array.isArray(instances) && instances.length > 0)
        .map(({ key }) => key);
      lastHealth = models.includes(model)
        ? Object.freeze({ available: true, models: Object.freeze(models) })
        : Object.freeze({ available: false, reason: `local_model_unavailable:${model}` });
    } catch (error) {
      lastHealth = Object.freeze({ available: false, reason: error.message });
    }
    return lastHealth;
  }

  async function generate({ messages = [], temperature, signal, stream = false, onDelta } = {}) {
    const state = await probe({ signal });
    if (!state.available) {
      if (['local_runtime_aborted', 'local_runtime_timeout'].includes(state.reason)) throw new Error(state.reason);
      if (state.reason?.startsWith('local_model_unavailable:')) throw new Error(state.reason);
      throw new Error('local_runtime_unavailable');
    }
    if (!state.models.includes(model)) throw new Error(`local_model_unavailable:${model}`);
    const requestOptions = {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(stream === true ? { accept: 'text/event-stream' } : {}) },
      body: JSON.stringify({ model, messages, stream: stream === true, ...(temperature !== undefined ? { temperature } : {}) }),
    };
    if (stream !== true) {
      const response = await request(`${root}/chat/completions`, requestOptions, signal);
      if (!response.ok) throw new Error(`lm_studio_http_${response.status}`);
      const body = await response.json();
      const choice = body.choices?.[0] ?? {};
      return Object.freeze({
        output: choice.message?.content ?? '',
        providerId: 'lm-studio',
        modelId: body.model ?? model,
        usage: usage(body.usage),
        rawUsage: structuredClone(body.usage ?? {}),
        finishReason: choice.finish_reason ?? null,
      });
    }

    const streamController = new AbortController();
    const forwardAbort = () => streamController.abort(signal?.reason);
    signal?.addEventListener('abort', forwardAbort, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      streamController.abort();
    }, timeoutMs);
    timer.unref?.();
    try {
      const response = await request(`${root}/chat/completions`, requestOptions, streamController.signal);
      if (!response.ok) throw new Error(`lm_studio_http_${response.status}`);
      const result = await readOpenAiSse(response, { onDelta, signal: streamController.signal });
      return Object.freeze({
        output: result.output,
        providerId: 'lm-studio',
        modelId: result.modelId ?? model,
        usage: usage(result.rawUsage),
        rawUsage: structuredClone(result.rawUsage ?? {}),
        finishReason: result.finishReason,
      });
    } catch (error) {
      if (timedOut) throw new Error('local_runtime_timeout');
      if (signal?.aborted) throw new Error('local_runtime_aborted');
      throw error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', forwardAbort);
    }
  }

  return Object.freeze({
    id: 'lm-studio', locality: 'local', network: 'loopback',
    capabilities: Object.freeze(['text.generate', 'reasoning.generate']),
    modelId: model,
    probe,
    health: () => lastHealth,
    generate,
    invoke: generate,
  });
}
