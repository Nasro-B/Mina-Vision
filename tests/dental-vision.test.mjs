import { describe, expect, it, vi } from 'vitest';
import {
  createDentalVision,
  createGeminiDentalProvider,
  createModalDentalProvider,
  createOpenRouterDentalProvider,
  parseDentalDecision,
} from '../src/providers/dental-vision.mjs';

const image = { data: Buffer.from('image'), mimeType: 'image/jpeg' };

describe('dental decision parser', () => {
  it.each([['OUI', true], [' oui. ', true], ['NON', false], ['non\n', false]])('parses %s', (text, expected) => {
    expect(parseDentalDecision(text)).toBe(expected);
  });

  it.each(['peut-être', '', 'OUI et NON'])('rejects ambiguous output %s', (text) => {
    expect(() => parseDentalDecision(text)).toThrow('Décision dentaire invalide');
  });
});

describe('dental provider routing', () => {
  it('can route the compatibility facade through capability vision.classify', async () => {
    const capabilityInvoker = { invoke: vi.fn(async () => ({ match: true, providerId: 'local-vision', modelId: 'vision-small' })) };
    const vision = createDentalVision({ capabilityInvoker, prompt: 'critères' });

    await expect(vision.classify(image)).resolves.toMatchObject({ match: true, provider: 'local-vision' });
    expect(capabilityInvoker.invoke).toHaveBeenCalledWith({
      capability: 'vision.classify', input: { ...image, prompt: 'critères' },
    });
  });

  it('falls back only when a provider errors', async () => {
    const gemini = { classify: vi.fn().mockRejectedValue(new Error('quota')) };
    const openrouter = { classify: vi.fn().mockResolvedValue('NON') };
    const modal = { classify: vi.fn().mockResolvedValue('OUI') };
    const vision = createDentalVision({ gemini, openrouter, modal, prompt: 'x' });

    await expect(vision.classify(image)).resolves.toMatchObject({ match: false, provider: 'openrouter' });
    expect(modal.classify).not.toHaveBeenCalled();
  });

  it('returns a valid Gemini NON without fallback', async () => {
    const gemini = { classify: vi.fn().mockResolvedValue('NON') };
    const openrouter = { classify: vi.fn() };
    const vision = createDentalVision({ gemini, openrouter, prompt: 'x' });

    await expect(vision.classify(image)).resolves.toMatchObject({ match: false, provider: 'gemini' });
    expect(openrouter.classify).not.toHaveBeenCalled();
  });

  it('fails after every configured provider errors', async () => {
    const vision = createDentalVision({
      gemini: { classify: vi.fn().mockRejectedValue(new Error('a')) },
      openrouter: { classify: vi.fn().mockRejectedValue(new Error('b')) },
      modal: { classify: vi.fn().mockRejectedValue(new Error('c')) },
      prompt: 'x',
    });

    await expect(vision.classify(image)).rejects.toThrow('Tous les fournisseurs vision ont échoué');
  });
});

describe('dental provider adapters', () => {
  it('sends inline image bytes to Gemini', async () => {
    const client = { models: { generateContent: vi.fn().mockResolvedValue({ text: 'OUI' }) } };
    const provider = createGeminiDentalProvider({ client, model: 'gemini-test' });

    await expect(provider.classify({ ...image, prompt: 'critères' })).resolves.toBe('OUI');
    expect(client.models.generateContent).toHaveBeenCalledWith(expect.objectContaining({ model: 'gemini-test' }));
  });

  it('defaults to the current stable multimodal Gemini model', async () => {
    const client = { models: { generateContent: vi.fn().mockResolvedValue({ text: 'NON' }) } };
    const provider = createGeminiDentalProvider({ client });

    await provider.classify({ ...image, prompt: 'critères' });

    expect(client.models.generateContent).toHaveBeenCalledWith(expect.objectContaining({ model: 'gemini-3.1-flash-lite' }));
  });

  it('uses one configured OpenRouter model', async () => {
    const client = { chat: { completions: { create: vi.fn().mockResolvedValue({ choices: [{ message: { content: 'NON' } }] }) } } };
    const provider = createOpenRouterDentalProvider({ client, model: 'vision/model' });

    await expect(provider.classify({ ...image, prompt: 'critères' })).resolves.toBe('NON');
    expect(client.chat.completions.create).toHaveBeenCalledWith(expect.objectContaining({ model: 'vision/model' }));
  });

  it('authenticates Modal without exposing token values', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ result: 'OUI' }) });
    const provider = createModalDentalProvider({
      fetchImpl,
      endpoint: 'https://modal.example/analyze',
      tokenId: 'id',
      tokenSecret: 'secret',
    });

    await expect(provider.classify({ ...image, prompt: 'critères' })).resolves.toBe('OUI');
    expect(fetchImpl).toHaveBeenCalledWith('https://modal.example/analyze', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: `Basic ${Buffer.from('id:secret').toString('base64')}` }),
    }));
  });
});
