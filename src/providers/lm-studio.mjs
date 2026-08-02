function usage(raw) {
  return Object.freeze({
    inputTokens: raw?.prompt_tokens ?? null,
    outputTokens: raw?.completion_tokens ?? null,
    totalTokens: raw?.total_tokens ?? null,
    completeness: raw?.prompt_tokens !== undefined && raw?.completion_tokens !== undefined ? 'final' : 'partial',
  });
}

export const DEFAULT_LM_STUDIO_TIMEOUT_MS = 240_000;

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

  async function generate({ messages = [], temperature, signal } = {}) {
    const state = await probe({ signal });
    if (!state.available) {
      if (['local_runtime_aborted', 'local_runtime_timeout'].includes(state.reason)) throw new Error(state.reason);
      if (state.reason?.startsWith('local_model_unavailable:')) throw new Error(state.reason);
      throw new Error('local_runtime_unavailable');
    }
    if (!state.models.includes(model)) throw new Error(`local_model_unavailable:${model}`);
    const response = await request(`${root}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, messages, stream: false, ...(temperature !== undefined ? { temperature } : {}) }),
    }, signal);
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
