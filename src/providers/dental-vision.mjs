export const DENTAL_VISION_PROMPT = `
Tu es un expert en marketing et esthétique dentaire pour une marque de blanchiment des dents.
Analyse uniquement l'image fournie.

Réponds OUI si l'image montre principalement au moins un élément suivant :
- comparaison avant/après de dents ;
- gros plan net d'un sourire ou de dents ;
- dents jaunes, tachées, très blanches ou résultat de blanchiment ;
- gouttière, lampe LED, gel, seringue ou accessoire de blanchiment ;
- écarteur dentaire ou nuancier de teintes ;
- miniature de tutoriel de blanchiment clairement dentaire.

Réponds NON pour les selfies ou groupes où les dents ne sont pas le sujet, paysages, aliments,
objets sans dents, captures d'écran, documents, radiographies, chirurgie, orthodontie ou portraits
à bouche fermée.

Réponds uniquement OUI ou NON.
`.trim();

export function parseDentalDecision(text) {
  const decision = String(text ?? '').trim().toUpperCase().replace(/[.!?]+$/u, '');
  if (decision === 'OUI') return true;
  if (decision === 'NON') return false;
  throw new Error('Décision dentaire invalide.');
}

export function createDentalVision({
  capabilityInvoker,
  gemini,
  openrouter,
  modal,
  prompt = DENTAL_VISION_PROMPT,
} = {}) {
  if (capabilityInvoker?.invoke) {
    return Object.freeze({
      classify: async (image) => {
        const result = await capabilityInvoker.invoke({
          capability: 'vision.classify', input: { ...image, prompt },
        });
        if (typeof result?.match !== 'boolean') throw new Error('Décision dentaire routée invalide.');
        return Object.freeze({
          match: result.match,
          provider: result.providerId ?? 'routed',
          modelId: result.modelId ?? null,
          rawDecision: result.match ? 'OUI' : 'NON',
        });
      },
    });
  }
  const providers = [
    ['gemini', gemini],
    ['openrouter', openrouter],
    ['modal', modal],
  ].filter(([, provider]) => provider);

  if (!providers.length) throw new Error('Aucun fournisseur vision configuré.');

  return Object.freeze({
    classify: async (image) => {
      const failures = [];
      for (const [name, provider] of providers) {
        try {
          const rawDecision = await provider.classify({ ...image, prompt });
          return Object.freeze({
            match: parseDentalDecision(rawDecision),
            provider: name,
            rawDecision: String(rawDecision).trim(),
          });
        } catch {
          failures.push(name);
        }
      }
      throw new Error(`Tous les fournisseurs vision ont échoué: ${failures.join(', ')}.`);
    },
  });
}

export function createGeminiDentalProvider({
  apiKey,
  client,
  model = 'gemini-3.1-flash-lite',
} = {}) {
  let currentClient = client;
  const getClient = async () => {
    if (!currentClient) {
      if (!apiKey) throw new Error('GEMINI_API_KEY manquante.');
      const { GoogleGenAI } = await import('@google/genai');
      currentClient = new GoogleGenAI({ apiKey });
    }
    return currentClient;
  };

  return Object.freeze({
    classify: async ({ data, mimeType, prompt }) => {
      const activeClient = await getClient();
      const response = await activeClient.models.generateContent({
        model,
        contents: [{
          role: 'user',
          parts: [
            { text: prompt },
            { inlineData: { data: Buffer.from(data).toString('base64'), mimeType } },
          ],
        }],
        config: { temperature: 0, maxOutputTokens: 8 },
      });
      return typeof response.text === 'function' ? response.text() : response.text;
    },
  });
}

export function createOpenRouterDentalProvider({ apiKey, client, model } = {}) {
  if (!model) throw new Error('OPENROUTER_VISION_MODEL manquant.');
  let currentClient = client;
  const getClient = async () => {
    if (!currentClient) {
      if (!apiKey) throw new Error('OPENROUTER_API_KEY manquante.');
      const { default: OpenAI } = await import('openai');
      currentClient = new OpenAI({ baseURL: 'https://openrouter.ai/api/v1', apiKey });
    }
    return currentClient;
  };

  return Object.freeze({
    classify: async ({ data, mimeType, prompt }) => {
      const activeClient = await getClient();
      const response = await activeClient.chat.completions.create({
        model,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: `data:${mimeType};base64,${Buffer.from(data).toString('base64')}` } },
          ],
        }],
        temperature: 0,
        max_tokens: 8,
      });
      return response.choices?.[0]?.message?.content;
    },
  });
}

export function createModalDentalProvider({
  fetchImpl = fetch,
  endpoint,
  tokenId,
  tokenSecret,
} = {}) {
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error('MODAL_ENDPOINT invalide.');
  }
  if (url.protocol !== 'https:') throw new Error('MODAL_ENDPOINT doit utiliser HTTPS.');
  if (tokenSecret && !tokenId) throw new Error('MODAL_TOKEN_ID manquant.');

  const authorization = tokenId && tokenSecret
    ? `Basic ${Buffer.from(`${tokenId}:${tokenSecret}`).toString('base64')}`
    : tokenId ? `Bearer ${tokenId}` : null;

  return Object.freeze({
    classify: async ({ data, mimeType }) => {
      const headers = { 'Content-Type': 'application/json' };
      if (authorization) headers.Authorization = authorization;
      const response = await fetchImpl(url.href, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          image_base64: Buffer.from(data).toString('base64'),
          mime_type: mimeType,
        }),
      });
      if (!response.ok) throw new Error(`Modal HTTP ${response.status}.`);
      const payload = await response.json();
      return payload.result;
    },
  });
}
