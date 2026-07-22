import { describe, expect, it, vi } from 'vitest';
import { createGeminiTextProvider } from '../src/providers/gemini-text.mjs';

describe('Gemini text provider', () => {
  it('generates a normalized text response', async () => {
    const generateContent = vi.fn(async () => ({
      text: 'Bonjour depuis Gemini',
      usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 4, totalTokenCount: 7 },
    }));
    const provider = createGeminiTextProvider({
      apiKey: 'test-key', model: 'gemini-test', client: { models: { generateContent } },
    });

    await expect(provider.generate({
      messages: [{ role: 'system', content: 'Instruction' }, { role: 'user', content: 'Bonjour' }],
      temperature: 0.3,
    })).resolves.toMatchObject({ output: 'Bonjour depuis Gemini', providerId: 'gemini', modelId: 'gemini-test' });
    expect(generateContent).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gemini-test',
      contents: [{ role: 'user', parts: [{ text: 'Bonjour' }] }],
      config: expect.objectContaining({ systemInstruction: 'Instruction', temperature: 0.3 }),
    }));
  });
});
