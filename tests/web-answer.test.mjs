import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { createGroqWebAnswer, createWebAnswerChain, createWebAnswerService } from '../src/research/web-answer.mjs';

const groundedResponse = ({ text = 'La fusée a décollé hier soir. Deux articles récents le confirment.', chunks } = {}) => ({
  ok: true,
  status: 200,
  json: async () => ({
    candidates: [{
      content: { parts: [{ text }] },
      groundingMetadata: {
        groundingChunks: chunks ?? [
          { web: { uri: 'https://presse.example/fusee', title: 'La fusée décolle' } },
          { web: { uri: 'https://science.example/lancement', title: 'Analyse du lancement' } },
        ],
      },
    }],
  }),
});

describe('createWebAnswerService — « trouve-moi un article » sans navigateur', () => {
  it('answers a query with grounded text and bounded, titled sources', async () => {
    const fetchImpl = vi.fn(async () => groundedResponse());
    const service = createWebAnswerService({ apiKey: 'test-key', fetchImpl });

    const result = await service.answer({ query: 'dernier lancement de fusée' });

    expect(result.text).toContain('décollé');
    expect(result.sources).toEqual([
      { title: 'La fusée décolle', url: 'https://presse.example/fusee' },
      { title: 'Analyse du lancement', url: 'https://science.example/lancement' },
    ]);
    const [url, options] = fetchImpl.mock.calls[0];
    expect(url).toContain('generativelanguage.googleapis.com');
    // Locked: gemini-2.5-flash answers 404 « no longer available to new users » on this project's
    // key (proved against the real API) — only the followed alias keeps working long-term.
    expect(url).toContain('gemini-flash-latest');
    const body = JSON.parse(options.body);
    expect(body.tools).toEqual([{ google_search: {} }]);
    expect(body.contents[0].parts[0].text).toContain('fusée');
  });

  it('never puts the API key in the URL — header only', async () => {
    const fetchImpl = vi.fn(async () => groundedResponse());
    const service = createWebAnswerService({ apiKey: 'super-secret', fetchImpl });

    await service.answer({ query: 'météo' });

    const [url, options] = fetchImpl.mock.calls[0];
    expect(url).not.toContain('super-secret');
    expect(options.headers['x-goog-api-key']).toBe('super-secret');
  });

  it('refuses an empty query and an unconfigured key with typed errors', async () => {
    const fetchImpl = vi.fn();
    await expect(createWebAnswerService({ apiKey: 'k', fetchImpl }).answer({ query: '   ' }))
      .rejects.toThrow('web_answer_query_required');
    await expect(createWebAnswerService({ apiKey: null, fetchImpl }).answer({ query: 'articles récents' }))
      .rejects.toThrow('web_answer_unconfigured');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('surfaces HTTP failures and empty answers as typed errors', async () => {
    const failing = createWebAnswerService({
      apiKey: 'k',
      fetchImpl: vi.fn(async () => ({ ok: false, status: 429, json: async () => ({}) })),
    });
    await expect(failing.answer({ query: 'actualité' })).rejects.toThrow('web_answer_http_429');

    const empty = createWebAnswerService({
      apiKey: 'k',
      fetchImpl: vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [] } }] }) })),
    });
    await expect(empty.answer({ query: 'actualité' })).rejects.toThrow('web_answer_empty');
  });

  it('drops sources without a URL and caps the list at three', async () => {
    const chunks = [
      { web: { uri: '', title: 'Sans lien' } },
      { web: { uri: 'https://a.example/1', title: 'Un' } },
      { web: { uri: 'https://a.example/2', title: 'Deux' } },
      { web: { uri: 'https://a.example/3', title: 'Trois' } },
      { web: { uri: 'https://a.example/4', title: 'Quatre' } },
    ];
    const service = createWebAnswerService({ apiKey: 'k', fetchImpl: vi.fn(async () => groundedResponse({ chunks })) });

    const result = await service.answer({ query: 'sujets' });

    expect(result.sources.map((source) => source.title)).toEqual(['Un', 'Deux', 'Trois']);
  });

  it('turns an abort into web_answer_timeout', async () => {
    const abortError = new Error('aborted');
    abortError.name = 'AbortError';
    const service = createWebAnswerService({ apiKey: 'k', fetchImpl: vi.fn(async () => { throw abortError; }) });

    await expect(service.answer({ query: 'article' })).rejects.toThrow('web_answer_timeout');
  });
});

describe('createGroqWebAnswer — web-search fallback (compound, server-side search)', () => {
  const groqResponse = ({ content = 'Electron 41.1.0 est la dernière version stable, sortie fin mars.', tools } = {}) => ({
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{
        message: {
          content,
          executed_tools: tools ?? [
            { type: 'visit', arguments: '{"url": "https://electronjs.org/releases"}' },
            { type: 'search', arguments: '{"query": "electron latest"}' },
          ],
        },
      }],
    }),
  });

  it('answers through the OpenAI-compatible endpoint with the key in the header, never the URL', async () => {
    const fetchImpl = vi.fn(async () => groqResponse());
    const service = createGroqWebAnswer({ apiKey: 'groq-secret', fetchImpl });

    const result = await service.answer({ query: 'dernière version electron' });

    expect(result.text).toContain('41.1.0');
    expect(result.model).toBe('groq/compound-mini');
    const [url, options] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(url).not.toContain('groq-secret');
    expect(options.headers.Authorization).toBe('Bearer groq-secret');
    const body = JSON.parse(options.body);
    expect(body.model).toBe('groq/compound-mini');
    expect(body.messages.at(-1).content).toContain('electron');
  });

  it('turns executed visit tools into journal sources and tolerates their absence', async () => {
    const withTools = createGroqWebAnswer({ apiKey: 'k', fetchImpl: vi.fn(async () => groqResponse()) });
    const sourced = await withTools.answer({ query: 'electron' });
    expect(sourced.sources).toEqual([{ title: 'electronjs.org', url: 'https://electronjs.org/releases' }]);

    const without = createGroqWebAnswer({ apiKey: 'k', fetchImpl: vi.fn(async () => groqResponse({ tools: [] })) });
    await expect(without.answer({ query: 'electron' })).resolves.toMatchObject({ sources: [] });
  });

  it('keeps the typed error contract: empty query, missing key, HTTP status, empty answer', async () => {
    const fetchImpl = vi.fn();
    await expect(createGroqWebAnswer({ apiKey: 'k', fetchImpl }).answer({ query: ' ' }))
      .rejects.toThrow('web_answer_query_required');
    await expect(createGroqWebAnswer({ apiKey: null, fetchImpl }).answer({ query: 'infos' }))
      .rejects.toThrow('web_answer_unconfigured');
    expect(fetchImpl).not.toHaveBeenCalled();

    const limited = createGroqWebAnswer({ apiKey: 'k', fetchImpl: vi.fn(async () => ({ ok: false, status: 429, json: async () => ({}) })) });
    await expect(limited.answer({ query: 'infos' })).rejects.toThrow('web_answer_http_429');

    const empty = createGroqWebAnswer({ apiKey: 'k', fetchImpl: vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '' } }] }) })) });
    await expect(empty.answer({ query: 'infos' })).rejects.toThrow('web_answer_empty');
  });
});

describe('createWebAnswerChain — Gemini first, Groq as rescue', () => {
  const success = (label) => ({ answer: vi.fn(async () => ({ text: label, sources: [], model: label })) });
  const failure = (message) => ({ answer: vi.fn(async () => { throw new Error(message); }) });

  it('returns the first provider answer without touching the fallback', async () => {
    const gemini = success('gemini');
    const groq = success('groq');
    const chain = createWebAnswerChain({ providers: [gemini, groq] });

    await expect(chain.answer({ query: 'articles' })).resolves.toMatchObject({ model: 'gemini' });
    expect(groq.answer).not.toHaveBeenCalled();
  });

  it('falls back to Groq when Gemini is out of quota, and surfaces the LAST error when all fail', async () => {
    const chain = createWebAnswerChain({ providers: [failure('web_answer_http_429'), success('groq')] });
    await expect(chain.answer({ query: 'articles' })).resolves.toMatchObject({ model: 'groq' });

    const allDown = createWebAnswerChain({ providers: [failure('web_answer_http_429'), failure('web_answer_http_500')] });
    await expect(allDown.answer({ query: 'articles' })).rejects.toThrow('web_answer_http_500');
  });

  it('does not retry an invalid query on the fallback, and reports unconfigured when empty', async () => {
    const groq = success('groq');
    const chain = createWebAnswerChain({ providers: [failure('web_answer_query_required'), groq] });
    await expect(chain.answer({ query: '' })).rejects.toThrow('web_answer_query_required');
    expect(groq.answer).not.toHaveBeenCalled();

    await expect(createWebAnswerChain({ providers: [] }).answer({ query: 'articles' }))
      .rejects.toThrow('web_answer_unconfigured');
  });
});

describe('web answer wiring contract — voice to IPC to service', () => {
  it('is reachable end-to-end: dialogue intent, live tool, IPC channel, preload bridge, renderer handler', async () => {
    const main = await readFile('src/ui/main.mjs', 'utf8');
    const preload = await readFile('src/ui/preload.cjs', 'utf8');
    const renderer = await readFile('src/ui/renderer.js', 'utf8');

    // main: service imported, IPC registered, live tool declared, instruction updated.
    expect(main).toContain("from '../research/web-answer.mjs'");
    expect(main).toContain('createWebAnswerChain');
    expect(main).toContain('createGroqWebAnswer');
    expect(main).toContain('groqApiKey');
    expect(main).toContain("ipcMain.handle('mina:web-answer'");
    expect(main).toContain("name: 'recherche_web'");
    expect(main).toMatch(/appelle l'outil correspondant \([^)]*recherche_web/u);

    // preload: renderer-side bridge.
    expect(preload).toContain("ipcRenderer.invoke('mina:web-answer'");

    // renderer: deterministic intent handled, live function call handled with dedup.
    expect(renderer).toMatch(/action\?\.type === 'web_search'/u);
    expect(renderer).toContain("name === 'recherche_web'");
    expect(renderer).toContain('api.webAnswer(');
  });
});
