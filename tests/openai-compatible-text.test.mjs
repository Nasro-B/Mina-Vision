import { describe, expect, it, vi } from 'vitest';
import { createOpenAiCompatibleTextProvider } from '../src/providers/openai-compatible-text.mjs';

describe('OpenAI-compatible text provider', () => {
  it('calls chat completions and normalizes the response', async () => {
    const create = vi.fn(async () => ({
      model: 'model-returned', choices: [{ message: { content: 'Réponse' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
    }));
    const provider = createOpenAiCompatibleTextProvider({
      id: 'openrouter', apiKey: 'test-key', baseURL: 'https://example.test/v1', model: 'model-test',
      client: { chat: { completions: { create } } },
    });

    await expect(provider.generate({ messages: [{ role: 'user', content: 'Bonjour' }], temperature: 0.3 }))
      .resolves.toMatchObject({ output: 'Réponse', providerId: 'openrouter', modelId: 'model-returned' });
  });

  it('concatenates a content made of multiple text parts (Modal structural response)', async () => {
    const create = vi.fn(async () => ({
      model: 'modal-vision', choices: [{
        message: { content: [{ type: 'text', text: 'Bonjour, ' }, { type: 'text', text: 'voici le diagnostic.' }] },
        finish_reason: 'stop',
      }],
    }));
    const provider = createOpenAiCompatibleTextProvider({
      id: 'modal', apiKey: 'test-key', baseURL: 'https://example.test/v1', model: 'model-test',
      client: { chat: { completions: { create } } },
    });

    await expect(provider.generate({ messages: [] })).resolves.toMatchObject({ output: 'Bonjour, voici le diagnostic.' });
  });

  it('never sends a reasoning-only message as the user-facing answer — treats it as empty', async () => {
    const create = vi.fn(async () => ({
      model: 'modal-reasoning',
      choices: [{ message: { content: '', reasoning_content: 'Je réfléchis à la réponse…' }, finish_reason: 'stop' }],
    }));
    const provider = createOpenAiCompatibleTextProvider({
      id: 'modal', apiKey: 'test-key', baseURL: 'https://example.test/v1', model: 'model-test',
      client: { chat: { completions: { create } } },
    });

    await expect(provider.generate({ messages: [] })).rejects.toThrow('modal_text_empty');
  });

  it('ignores non-text parts (e.g. a stray image echo) when concatenating', async () => {
    const create = vi.fn(async () => ({
      model: 'modal-vision',
      choices: [{ message: { content: [{ type: 'text', text: 'Résultat: ' }, { type: 'image_url', image_url: { url: 'x' } }, { type: 'text', text: 'ok' }] } }],
    }));
    const provider = createOpenAiCompatibleTextProvider({
      id: 'modal', apiKey: 'test-key', baseURL: 'https://example.test/v1', model: 'model-test',
      client: { chat: { completions: { create } } },
    });

    await expect(provider.generate({ messages: [] })).resolves.toMatchObject({ output: 'Résultat: ok' });
  });

  it('still rejects a genuinely empty response as <id>_text_empty', async () => {
    const create = vi.fn(async () => ({ model: 'x', choices: [{ message: { content: '' } }] }));
    const provider = createOpenAiCompatibleTextProvider({
      id: 'modal', apiKey: 'test-key', baseURL: 'https://example.test/v1', model: 'model-test',
      client: { chat: { completions: { create } } },
    });

    await expect(provider.generate({ messages: [] })).rejects.toThrow('modal_text_empty');
  });
});
