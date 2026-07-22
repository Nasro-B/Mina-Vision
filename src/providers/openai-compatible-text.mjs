// Most OpenAI-compatible backends return `message.content` as a plain string, but some
// (Modal's structural/vision responses, reasoning-parser backends) return an array of typed
// parts, or leave `content` empty while the actual text sits in a separate reasoning field.
// A reasoning-only message is deliberately treated as empty — it is model scratch-work, never
// the answer shown to the user.
function extractText(message) {
  const { content } = message ?? {};
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content
      .filter((part) => part?.type === 'text' && typeof part.text === 'string')
      .map((part) => part.text)
      .join('')
      .trim();
  }
  return '';
}

function normalizedUsage(raw = {}) {
  return Object.freeze({
    inputTokens: Number.isFinite(raw.prompt_tokens) ? raw.prompt_tokens : null,
    outputTokens: Number.isFinite(raw.completion_tokens) ? raw.completion_tokens : null,
    totalTokens: Number.isFinite(raw.total_tokens) ? raw.total_tokens : null,
    completeness: Number.isFinite(raw.prompt_tokens) && Number.isFinite(raw.completion_tokens) ? 'final' : 'partial',
  });
}

export function createOpenAiCompatibleTextProvider({
  id, apiKey, baseURL, model, defaultHeaders, client, timeoutMs = 90_000,
} = {}) {
  if (!id || !model || (!apiKey && !client)) throw new TypeError('openai_text_provider_configuration_invalid');
  let activeClient = client;
  const getClient = async () => {
    if (!activeClient) {
      const { default: OpenAI } = await import('openai');
      activeClient = new OpenAI({ apiKey, baseURL, defaultHeaders, timeout: timeoutMs, maxRetries: 0 });
    }
    return activeClient;
  };

  async function generate({ messages = [], temperature = 0.3, signal } = {}) {
    const response = await (await getClient()).chat.completions.create({
      model, messages, temperature, max_tokens: 1_024, stream: false,
    }, signal ? { signal } : undefined);
    const output = extractText(response.choices?.[0]?.message);
    if (!output) throw new Error(`${id}_text_empty`);
    return Object.freeze({
      output,
      providerId: id,
      modelId: response.model ?? model,
      usage: normalizedUsage(response.usage),
      rawUsage: structuredClone(response.usage ?? {}),
      finishReason: response.choices?.[0]?.finish_reason ?? null,
    });
  }

  return Object.freeze({ id, locality: 'cloud', generate });
}
