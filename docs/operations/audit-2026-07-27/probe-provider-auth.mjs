import 'dotenv/config';

const modalTokenId = process.env.MODAL_PROXY_TOKEN_ID
  ?? process.env.MODAL_TOKEN_ID
  ?? process.env.MODAL_TOKEN;
const modalTokenSecret = process.env.MODAL_PROXY_TOKEN_SECRET
  ?? process.env.MODAL_TOKEN_SECRET;

const probes = [
  {
    name: 'gemini',
    configured: Boolean(process.env.GEMINI_API_KEY),
    request: () => ({
      url: `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`,
    }),
  },
  {
    name: 'openrouter',
    configured: Boolean(process.env.OPENROUTER_API_KEY),
    request: () => ({
      url: 'https://openrouter.ai/api/v1/models',
      headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` },
    }),
  },
  {
    name: 'groq',
    configured: Boolean(process.env.GROQ_API_KEY),
    request: () => ({
      url: 'https://api.groq.com/openai/v1/models',
      headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
    }),
  },
  {
    name: 'deepgram',
    configured: Boolean(process.env.DEEPGRAM_API_KEY),
    request: () => ({
      url: 'https://api.deepgram.com/v1/projects',
      headers: { Authorization: `Token ${process.env.DEEPGRAM_API_KEY}` },
    }),
  },
  {
    name: 'deepseek',
    configured: Boolean(process.env.DEEPSEEK_API_KEY),
    request: () => ({
      url: 'https://api.deepseek.com/models',
      headers: { Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}` },
    }),
  },
  {
    name: 'modal',
    configured: Boolean(modalTokenId && modalTokenSecret && process.env.MODAL_ENDPOINT),
    request: () => {
      const root = process.env.MODAL_ENDPOINT.replace(/\/+$/u, '').replace(/\/v1$/u, '');
      return {
        url: `${root}/v1/models`,
        headers: {
          'Modal-Key': modalTokenId,
          'Modal-Secret': modalTokenSecret,
        },
      };
    },
  },
];

const results = [];
for (const probe of probes) {
  if (!probe.configured) {
    results.push({ name: probe.name, configured: false });
    continue;
  }
  const startedAt = performance.now();
  try {
    const { url, headers } = probe.request();
    const response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(15_000),
    });
    results.push({
      name: probe.name,
      configured: true,
      status: response.status,
      durationMs: Math.round(performance.now() - startedAt),
    });
  } catch (error) {
    results.push({
      name: probe.name,
      configured: true,
      error: error.name,
      durationMs: Math.round(performance.now() - startedAt),
    });
  }
}

process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
