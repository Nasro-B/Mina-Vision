import { describe, expect, it, vi } from 'vitest';
import { createComputerUseRuntime } from '../src/providers/computer-use-runtime.mjs';

const observation = Object.freeze({
  imageBase64: Buffer.from('screen').toString('base64'),
  mimeType: 'image/png',
  width: 1_000,
  height: 700,
});

const completed = JSON.stringify({ completed: true, text: 'Terminé par OpenRouter.', action: null });

describe('Computer Use runtime composition', () => {
  it('uses Gemma through LM Studio for strict local-only computer actions', async () => {
    const localCreate = vi.fn().mockResolvedValue({ choices: [{ message: { content: completed } }] });
    const openAiClientFactory = vi.fn(() => ({ chat: { completions: { create: localCreate } } }));
    const runtime = createComputerUseRuntime({
      config: {
        inference: { mode: 'local-only', offline: true },
        providers: {
          lmStudio: {
            enabled: true,
            baseUrl: 'http://127.0.0.1:1234/v1',
            model: 'google/gemma-4-e2b',
            timeoutMs: 240_000,
          },
        },
      },
      openAiClientFactory,
    });

    await expect(runtime.computerUse.start({
      goal: 'Ouvre YouTube', environment: 'browser', observation,
    })).resolves.toMatchObject({ completed: true, providerId: 'lm-studio-computer-use' });
    expect(runtime.providers).toEqual([
      expect.objectContaining({
        id: 'lm-studio-computer-use', locality: 'local', network: 'loopback', modelId: 'google/gemma-4-e2b',
      }),
    ]);
    expect(openAiClientFactory).toHaveBeenCalledWith(expect.objectContaining({
      baseURL: 'http://127.0.0.1:1234/v1', timeoutMs: 240_000,
    }));
    expect(localCreate).toHaveBeenCalledWith(expect.objectContaining({ max_tokens: 512 }));
  });

  it('falls back from Gemini to Modal and then OpenRouter in auto mode', async () => {
    const geminiClient = {
      start: vi.fn().mockRejectedValue(Object.assign(new Error('quota 429'), { status: 429 })),
      continue: vi.fn(),
    };
    const modalCreate = vi.fn().mockRejectedValue(Object.assign(new Error('Modal HTTP 503'), { status: 503 }));
    const openrouterCreate = vi.fn().mockResolvedValue({ choices: [{ message: { content: completed } }] });
    const openAiClientFactory = vi.fn(({ baseURL }) => ({
      chat: { completions: { create: baseURL.includes('modal.direct') ? modalCreate : openrouterCreate } },
    }));
    const config = {
      geminiApiKey: 'gemini',
      openrouterApiKey: 'openrouter',
      openrouterVisionModel: null,
      modalEndpoint: 'https://example.modal.direct',
      modalTokenId: 'modal-id',
      modalTokenSecret: 'modal-secret',
      inference: { mode: 'auto', offline: false },
      providers: {
        gemini: { model: 'gemini-3.5-flash' },
        openrouter: { baseUrl: 'https://openrouter.ai/api/v1', model: null },
        modal: { model: 'Qwen/Qwen3.5-9B' },
      },
    };
    const runtime = createComputerUseRuntime({ config, geminiClient, openAiClientFactory });

    const result = await runtime.computerUse.start({
      goal: 'Ouvre YouTube', environment: 'browser', observation,
    });

    expect(result).toMatchObject({ completed: true, text: 'Terminé par OpenRouter.' });
    expect(geminiClient.start).toHaveBeenCalledTimes(1);
    expect(modalCreate).toHaveBeenCalledTimes(1);
    expect(openrouterCreate).toHaveBeenCalledTimes(1);
    expect(runtime.providers.map(({ id }) => id)).toEqual([
      'gemini-computer-use', 'modal-computer-use', 'openrouter-computer-use', 'openrouter-free-router-computer-use',
    ]);
    expect(runtime.providers.find(({ id }) => id === 'openrouter-computer-use')?.modelId)
      .toBe('google/gemma-4-26b-a4b-it:free');
  });

  it('does not bypass an explicit model safety refusal', async () => {
    const geminiClient = {
      start: vi.fn().mockRejectedValue(new Error('safety_blocked')),
      continue: vi.fn(),
    };
    const openrouterCreate = vi.fn().mockResolvedValue({ choices: [{ message: { content: completed } }] });
    const runtime = createComputerUseRuntime({
      config: {
        geminiApiKey: 'gemini', openrouterApiKey: 'openrouter', openrouterVisionModel: 'vision',
        modalEndpoint: null, modalTokenId: null, modalTokenSecret: null,
        inference: { mode: 'auto', offline: false },
        providers: {
          gemini: { model: 'gemini' },
          openrouter: { baseUrl: 'https://openrouter.ai/api/v1', model: 'vision' },
          modal: { model: null },
        },
      },
      geminiClient,
      openAiClientFactory: () => ({ chat: { completions: { create: openrouterCreate } } }),
    });

    await expect(runtime.computerUse.start({ goal: 'test', environment: 'browser', observation }))
      .rejects.toThrow('safety_blocked');
    expect(openrouterCreate).not.toHaveBeenCalled();
  });
});
