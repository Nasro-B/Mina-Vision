// « Trouve-moi un article » sans ouvrir le navigateur : une réponse web EN DIRECT via l'API
// Gemini avec l'outil google_search (grounding). Réutilise la clé Gemini déjà configurée —
// aucun nouveau secret, aucune mission navigateur, une réponse courte pensée pour être LUE À VOIX
// HAUTE, avec les sources réelles rendues séparément pour le journal.

// Alias suivi par Google — vérifié contre la vraie API : « gemini-2.5-flash » répond 404
// « no longer available to new users » pour la clé de ce projet, l'alias reste valide.
const DEFAULT_MODEL = 'gemini-flash-latest';
const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_QUERY_LENGTH = 400;
const MAX_SOURCES = 3;

const SPOKEN_STYLE = [
  'Réponds en français, en 2 à 4 phrases courtes et naturelles destinées à être lues à voix haute.',
  "Donne les faits trouvés sur le web, sans lire d'URL ni de code.",
  'Si les résultats sont contradictoires ou introuvables, dis-le honnêtement.',
].join(' ');

function requireQuery(query) {
  const trimmed = String(query ?? '').trim().slice(0, MAX_QUERY_LENGTH);
  if (!trimmed) throw new Error('web_answer_query_required');
  return trimmed;
}

export function createWebAnswerService({
  apiKey,
  fetchImpl = globalThis.fetch,
  model = DEFAULT_MODEL,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  async function answer({ query } = {}) {
    const trimmed = requireQuery(query);
    if (!apiKey) throw new Error('web_answer_unconfigured');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    timer.unref?.();
    let response;
    try {
      // La clé reste en en-tête — jamais dans l'URL (les URLs finissent dans des logs).
      response = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: trimmed }] }],
          tools: [{ google_search: {} }],
          systemInstruction: { parts: [{ text: SPOKEN_STYLE }] },
        }),
        signal: controller.signal,
      });
    } catch (error) {
      throw new Error(error?.name === 'AbortError' ? 'web_answer_timeout' : 'web_answer_network', { cause: error });
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) throw new Error(`web_answer_http_${response.status}`);
    const payload = await response.json();
    const candidate = payload?.candidates?.[0];
    const text = (candidate?.content?.parts ?? [])
      .map((part) => (typeof part?.text === 'string' ? part.text : ''))
      .join('')
      .trim();
    if (!text) throw new Error('web_answer_empty');

    const sources = (candidate?.groundingMetadata?.groundingChunks ?? [])
      .map((chunk) => ({
        title: String(chunk?.web?.title ?? '').slice(0, 120),
        url: String(chunk?.web?.uri ?? ''),
      }))
      .filter((source) => source.url)
      .slice(0, MAX_SOURCES)
      .map((source) => Object.freeze(source));

    return Object.freeze({ text, sources: Object.freeze(sources), model });
  }

  return Object.freeze({ answer });
}

// Secours quand le quota gratuit Gemini est épuisé : les modèles Groq « compound » exécutent la
// recherche web CÔTÉ SERVEUR (endpoint OpenAI-compatible classique, ~1 s mesuré en réel) — même
// contrat answer({query}) → {text, sources, model}, mêmes erreurs typées.
const GROQ_DEFAULT_MODEL = 'groq/compound-mini';
const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';

export function createGroqWebAnswer({
  apiKey,
  fetchImpl = globalThis.fetch,
  model = GROQ_DEFAULT_MODEL,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  async function answer({ query } = {}) {
    const trimmed = requireQuery(query);
    if (!apiKey) throw new Error('web_answer_unconfigured');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    timer.unref?.();
    let response;
    try {
      response = await fetchImpl(GROQ_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: SPOKEN_STYLE },
            { role: 'user', content: trimmed },
          ],
        }),
        signal: controller.signal,
      });
    } catch (error) {
      throw new Error(error?.name === 'AbortError' ? 'web_answer_timeout' : 'web_answer_network', { cause: error });
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) throw new Error(`web_answer_http_${response.status}`);
    const payload = await response.json();
    const message = payload?.choices?.[0]?.message;
    const text = String(message?.content ?? '').trim();
    if (!text) throw new Error('web_answer_empty');

    // Les outils exécutés côté serveur (visites de pages) donnent les sources du journal ; leur
    // forme n'est pas contractuelle chez Groq, donc tout est défensif et leur absence est normale.
    const urls = new Set();
    for (const tool of Array.isArray(message?.executed_tools) ? message.executed_tools : []) {
      try {
        const url = JSON.parse(tool?.arguments ?? '{}')?.url;
        if (typeof url === 'string' && url.startsWith('http')) urls.add(url);
      } catch { /* outil sans URL exploitable */ }
    }
    const sources = [...urls].slice(0, MAX_SOURCES).map((url) => {
      let title = '';
      try { title = new URL(url).hostname; } catch { /* URL brute gardée sans titre */ }
      return Object.freeze({ title, url });
    });

    return Object.freeze({ text, sources: Object.freeze(sources), model });
  }

  return Object.freeze({ answer });
}

// Essaie chaque fournisseur dans l'ordre (Gemini d'abord : citations propres ; Groq en secours).
// Une requête invalide ne se réessaie jamais ; sinon la DERNIÈRE erreur remonte au journal.
export function createWebAnswerChain({ providers = [] } = {}) {
  const active = providers.filter(Boolean);

  async function answer(request) {
    if (active.length === 0) throw new Error('web_answer_unconfigured');
    let lastError = null;
    for (const provider of active) {
      try {
        return await provider.answer(request);
      } catch (error) {
        if (String(error?.message) === 'web_answer_query_required') throw error;
        lastError = error;
      }
    }
    throw lastError;
  }

  return Object.freeze({ answer });
}
