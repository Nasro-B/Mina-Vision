const DEFAULT_PROMPT = [
  'Décris en français uniquement ce qui est réellement visible dans cette image de caméra.',
  "Distingue les observations certaines des éléments incertains et n'invente aucun détail hors champ.",
  "Ne confirme jamais l'identité d'une personne à partir de son visage : décris-la sans la nommer.",
].join(' ');

function cameraInput({ image, mimeType, prompt = 'Que vois-tu ?' } = {}) {
  const bytes = Buffer.from(image ?? []);
  if (bytes.length < 1 || bytes.length > 2 * 1024 * 1024 || mimeType !== 'image/jpeg'
    || typeof prompt !== 'string' || prompt.length < 1 || prompt.length > 2_000 || prompt.includes('\0')) {
    throw new TypeError('camera_vision_input_invalid');
  }
  return Object.freeze({ bytes, mimeType, prompt });
}

export function createGeminiCameraVision({ apiKey, client, model = 'gemini-3.1-flash-lite' } = {}) {
  let currentClient = client;
  const getClient = async () => {
    if (!currentClient) {
      if (!apiKey) throw new Error('GEMINI_API_KEY manquante.');
      const { GoogleGenAI } = await import('@google/genai');
      currentClient = new GoogleGenAI({ apiKey });
    }
    return currentClient;
  };

  async function analyze({ image, mimeType, prompt = 'Que vois-tu ?' } = {}) {
    const { bytes } = cameraInput({ image, mimeType, prompt });
    const activeClient = await getClient();
    const response = await activeClient.models.generateContent({
      model,
      contents: [{
        role: 'user',
        parts: [
          { text: `${DEFAULT_PROMPT}\nQuestion du créateur : ${prompt}` },
          { inlineData: { data: bytes.toString('base64'), mimeType } },
        ],
      }],
      config: { temperature: 0, maxOutputTokens: 320 },
    });
    const text = String(typeof response.text === 'function' ? response.text() : response.text ?? '').trim();
    if (!text) throw new Error('camera_vision_empty_result');
    return Object.freeze({ text: text.slice(0, 4_000), modelId: model });
  }

  return Object.freeze({ id: 'gemini-camera-vision', locality: 'cloud', analyze });
}

export function createOpenAiCompatibleCameraVision({
  id,
  apiKey,
  baseURL,
  model,
  defaultHeaders,
  client,
  clientFactory,
  locality = 'cloud',
  timeoutMs = 180_000,
  maxOutputTokens = 320,
} = {}) {
  if (!id || !model) throw new TypeError('camera_vision_provider_config_invalid');
  let currentClient = client;
  const getClient = async () => {
    if (currentClient) return currentClient;
    if (!apiKey) throw new Error(`${id}_api_key_missing`);
    if (clientFactory) currentClient = await clientFactory({ apiKey, baseURL, defaultHeaders, timeoutMs });
    else {
      const { default: OpenAI } = await import('openai');
      currentClient = new OpenAI({ apiKey, baseURL, defaultHeaders, timeout: timeoutMs, maxRetries: 0 });
    }
    return currentClient;
  };

  async function analyze(input = {}) {
    const { bytes, mimeType, prompt } = cameraInput(input);
    const activeClient = await getClient();
    const response = await activeClient.chat.completions.create({
      model,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: `${DEFAULT_PROMPT}\nQuestion du créateur : ${prompt}` },
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${bytes.toString('base64')}` } },
        ],
      }],
      temperature: 0,
      max_tokens: maxOutputTokens,
    });
    const text = String(response?.choices?.[0]?.message?.content ?? '').trim();
    if (!text) throw new Error('camera_vision_empty_result');
    return Object.freeze({ text: text.slice(0, 4_000), modelId: model });
  }

  return Object.freeze({ id, locality, analyze });
}

export function createRoutedCameraVision({ providers = [], mode = 'auto', offline = false } = {}) {
  if (!['auto', 'local-first', 'local-only'].includes(mode)) throw new TypeError('camera_vision_mode_invalid');
  const usable = providers.filter((provider) => provider?.id && typeof provider.analyze === 'function');
  const local = usable.filter((provider) => provider.locality === 'local');
  const cloud = usable.filter((provider) => provider.locality !== 'local');
  const routes = offline || mode === 'local-only'
    ? local
    : mode === 'local-first'
      ? [...local, ...cloud]
      : [...cloud, ...local];

  return Object.freeze({
    analyze: async (input) => {
      const failures = [];
      for (const provider of routes) {
        try {
          const result = await provider.analyze(input);
          return Object.freeze({ ...result, providerId: provider.id });
        } catch (error) {
          failures.push(`${provider.id}:${error.message}`);
        }
      }
      throw new Error(routes.length
        ? `camera_vision_all_providers_failed:${failures.join('|')}`
        : 'camera_vision_no_provider_for_mode');
    },
  });
}
