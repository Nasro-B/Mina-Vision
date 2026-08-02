import { describe, expect, it, vi } from 'vitest';
import { createCameraVisionRuntime } from '../src/providers/camera-vision-runtime.mjs';

const image = Object.freeze({ image: Buffer.from('jpeg'), mimeType: 'image/jpeg', prompt: 'Que vois-tu ?' });

describe('camera vision runtime', () => {
  it('falls back from Gemini to an OpenRouter multimodal model', async () => {
    const geminiClient = { models: { generateContent: vi.fn(async () => { throw new Error('quota'); }) } };
    const openAiClient = { chat: { completions: { create: vi.fn(async () => ({
      choices: [{ message: { content: 'Je vois un écran.' } }],
    })) } } };
    const runtime = createCameraVisionRuntime({
      config: {
        inference: { mode: 'auto', offline: false },
        geminiApiKey: 'gemini',
        openrouterApiKey: 'openrouter',
        providers: { openrouter: { baseUrl: 'https://openrouter.ai/api/v1', model: null } },
      },
      geminiClient,
      openAiClientFactory: vi.fn(async () => openAiClient),
    });

    await expect(runtime.cameraVision.analyze(image)).resolves.toMatchObject({
      text: 'Je vois un écran.', providerId: 'openrouter-camera-vision',
    });
    expect(runtime.providers).toEqual(expect.arrayContaining([
      'gemini-camera-vision', 'openrouter-camera-vision', 'openrouter-free-router-camera-vision',
    ]));
  });

  it('uses only LM Studio when local-only is selected', async () => {
    const localCreate = vi.fn(async () => ({
      choices: [{ message: { content: 'Vision locale.' } }],
    }));
    const localClient = { chat: { completions: { create: localCreate } } };
    const runtime = createCameraVisionRuntime({
      config: {
        inference: { mode: 'local-only', offline: true },
        providers: {
          lmStudio: {
            enabled: true,
            visionEnabled: true,
            baseUrl: 'http://127.0.0.1:1234/v1',
            model: 'local-text',
            visionModel: 'google/gemma-4-e2b',
          },
        },
      },
      openAiClientFactory: vi.fn(async () => localClient),
    });

    await expect(runtime.cameraVision.analyze(image)).resolves.toMatchObject({
      text: 'Vision locale.', providerId: 'lm-studio-camera-vision', modelId: 'google/gemma-4-e2b',
    });
    expect(localCreate).toHaveBeenCalledWith(expect.objectContaining({ max_tokens: 640 }));
  });

  it('does not expose local camera vision until it has been explicitly enabled', () => {
    const runtime = createCameraVisionRuntime({
      config: {
        inference: { mode: 'local-only', offline: true },
        providers: {
          lmStudio: {
            enabled: true,
            visionEnabled: false,
            baseUrl: 'http://127.0.0.1:1234/v1',
            model: 'local-text',
            visionModel: 'google/gemma-4-e2b',
          },
        },
      },
    });

    expect(runtime.providers).not.toContain('lm-studio-camera-vision');
  });

  it('does not register a text-only Modal endpoint as a camera vision provider', () => {
    const runtime = createCameraVisionRuntime({
      config: {
        inference: { mode: 'auto', offline: false },
        modalEndpoint: 'https://example.modal.direct', modalTokenId: 'id', modalTokenSecret: 'secret',
        providers: { modal: { model: 'Qwen/Qwen3.5-9B' } },
      },
    });

    expect(runtime.providers).not.toContain('modal-camera-vision');
  });
});
