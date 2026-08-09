const DEPRECATION_AT = Date.parse('2026-07-24T15:59:00Z');
const CURRENT_MODELS = new Set(['deepseek-v4-flash', 'deepseek-v4-pro']);
const LEGACY_MODELS = new Set(['deepseek-chat', 'deepseek-reasoner']);

function normalizeUsage(raw, { complete = true } = {}) {
  const inputTokens = Number.isFinite(raw?.prompt_tokens) ? raw.prompt_tokens : null;
  const outputTokens = Number.isFinite(raw?.completion_tokens) ? raw.completion_tokens : null;
  return Object.freeze({
    inputTokens,
    outputTokens,
    cachedInputTokens: Number.isFinite(raw?.prompt_cache_hit_tokens)
      ? raw.prompt_cache_hit_tokens
      : raw?.prompt_tokens_details?.cached_tokens ?? null,
    reasoningTokens: raw?.completion_tokens_details?.reasoning_tokens ?? null,
    completeness: complete && inputTokens !== null && outputTokens !== null ? 'final' : 'partial',
  });
}

function normalizeError(error, timedOut) {
  if (timedOut || error?.name === 'AbortError') return new Error('deepseek_timeout');
  if (error?.status === 401 || error?.statusCode === 401) return new Error('deepseek_auth_failed');
  return error;
}

async function defaultClientFactory({ apiKey, baseURL }) {
  const { default: OpenAI } = await import('openai');
  return new OpenAI({ apiKey, baseURL });
}

export function createDeepSeekProvider({
  apiKeyProvider,
  baseURL = 'https://api.deepseek.com',
  model = 'deepseek-v4-flash',
  clientFactory = defaultClientFactory,
  timeoutMs = 60_000,
  clock = Date.now,
  onEvent = () => {},
} = {}) {
  if (typeof apiKeyProvider !== 'function' || typeof clientFactory !== 'function') {
    throw new TypeError('deepseek_provider_configuration_required');
  }
  if (!CURRENT_MODELS.has(model) && !LEGACY_MODELS.has(model)) throw new Error(`deepseek_model_invalid:${model}`);
  const now = Number(typeof clock === 'function' ? clock() : clock.now());
  if (LEGACY_MODELS.has(model)) {
    if (now >= DEPRECATION_AT) throw new Error(`deepseek_model_deprecated:${model}`);
    onEvent(Object.freeze({
      type: 'provider_model_deprecated', providerId: 'deepseek', modelId: model,
      deadline: new Date(DEPRECATION_AT).toISOString(),
    }));
  }

  async function execute({ messages, stream, thinking, reasoningEffort, signal, onDelta }) {
    const supplied = await apiKeyProvider();
    const apiKey = typeof supplied === 'string' ? supplied : supplied?.apiKey;
    if (!apiKey) throw new Error('deepseek_api_key_missing');
    const client = await clientFactory({ apiKey, baseURL });
    const controller = new AbortController();
    const forwardAbort = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', forwardAbort, { once: true });
    let timedOut = false;
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(new Error('deepseek_timeout'));
      }, timeoutMs);
      timer.unref?.();
    });

    const invoke = async () => {
      const payload = {
        model,
        messages: Array.isArray(messages) ? messages : [],
        stream: stream === true,
        ...(thinking === true ? { thinking: { type: 'enabled' } } : {}),
        ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
        ...(stream === true ? { stream_options: { include_usage: true } } : {}),
      };
      const response = await client.chat.completions.create(payload, { signal: controller.signal });
      if (stream !== true) {
        const choice = response.choices?.[0] ?? {};
        return Object.freeze({
          output: choice.message?.content ?? '',
          providerId: 'deepseek',
          modelId: response.model ?? model,
          usage: normalizeUsage(response.usage),
          finishReason: choice.finish_reason ?? null,
          rawUsage: structuredClone(response.usage ?? {}),
        });
      }

      let output = '';
      let finishReason = null;
      let rawUsage = null;
      for await (const chunk of response) {
        const choice = chunk.choices?.[0];
        const delta = choice?.delta?.content ?? '';
        if (delta) {
          output += delta;
          await onDelta?.(delta);
        }
        if (choice?.finish_reason) finishReason = choice.finish_reason;
        if (chunk.usage) rawUsage = chunk.usage;
      }
      return Object.freeze({
        output,
        providerId: 'deepseek',
        modelId: model,
        usage: normalizeUsage(rawUsage, { complete: Boolean(finishReason) }),
        finishReason,
        rawUsage: structuredClone(rawUsage ?? {}),
      });
    };

    try {
      return await Promise.race([invoke(), timeout]);
    } catch (error) {
      throw normalizeError(error, timedOut);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', forwardAbort);
    }
  }

  return Object.freeze({
    id: 'deepseek',
    locality: 'cloud',
    network: 'internet',
    capabilities: Object.freeze(['text.generate', 'reasoning.generate']),
    modelId: model,
    health: () => Object.freeze({ available: true }),
    generate: execute,
    invoke: execute,
  });
}
