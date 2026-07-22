function normalizedUsage(raw = {}) {
  return Object.freeze({
    inputTokens: Number.isFinite(raw.promptTokenCount) ? raw.promptTokenCount : null,
    outputTokens: Number.isFinite(raw.candidatesTokenCount) ? raw.candidatesTokenCount : null,
    totalTokens: Number.isFinite(raw.totalTokenCount) ? raw.totalTokenCount : null,
    completeness: Number.isFinite(raw.promptTokenCount) && Number.isFinite(raw.candidatesTokenCount) ? 'final' : 'partial',
  });
}

export function createGeminiTextProvider({ apiKey, model = 'gemini-3.5-flash', client } = {}) {
  if (!apiKey && !client) throw new Error('gemini_api_key_missing');
  let activeClient = client;
  const getClient = async () => {
    if (!activeClient) {
      const { GoogleGenAI } = await import('@google/genai');
      activeClient = new GoogleGenAI({ apiKey });
    }
    return activeClient;
  };

  async function generate({ messages = [], temperature = 0.3 } = {}) {
    const systemInstruction = messages.filter(({ role }) => role === 'system').map(({ content }) => content).join('\n');
    const contents = messages.filter(({ role }) => role !== 'system').map(({ role, content }) => ({
      role: role === 'assistant' ? 'model' : 'user',
      parts: [{ text: String(content ?? '') }],
    }));
    const response = await (await getClient()).models.generateContent({
      model,
      contents,
      config: { ...(systemInstruction ? { systemInstruction } : {}), temperature, maxOutputTokens: 1_024 },
    });
    const output = String(typeof response.text === 'function' ? response.text() : response.text ?? '').trim();
    if (!output) throw new Error('gemini_text_empty');
    return Object.freeze({
      output,
      providerId: 'gemini',
      modelId: model,
      usage: normalizedUsage(response.usageMetadata),
      rawUsage: structuredClone(response.usageMetadata ?? {}),
      finishReason: response.candidates?.[0]?.finishReason ?? null,
    });
  }

  return Object.freeze({ id: 'gemini', locality: 'cloud', generate });
}
