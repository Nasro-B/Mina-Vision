import { describe, expect, it, vi } from 'vitest';
import {
  createGeminiCameraVision,
  createOpenAiCompatibleCameraVision,
  createRoutedCameraVision,
} from '../src/providers/camera-vision.mjs';

describe('camera vision', () => {
  it('sends the current JPEG to a multimodal model and returns only grounded visual text', async () => {
    const client = { models: { generateContent: vi.fn(async () => ({ text: 'Je vois une personne devant un bureau.' })) } };
    const vision = createGeminiCameraVision({ client, model: 'gemini-test' });
    const image = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);

    await expect(vision.analyze({ image, mimeType: 'image/jpeg', prompt: 'Que vois-tu ?' }))
      .resolves.toEqual({ text: 'Je vois une personne devant un bureau.', modelId: 'gemini-test' });
    expect(client.models.generateContent).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gemini-test',
      contents: [expect.objectContaining({
        parts: expect.arrayContaining([expect.objectContaining({ inlineData: expect.objectContaining({ mimeType: 'image/jpeg' }) })]),
      })],
    }));
  });

  it('rejects empty images and empty model answers instead of inventing a description', async () => {
    const client = { models: { generateContent: vi.fn(async () => ({ text: '' })) } };
    const vision = createGeminiCameraVision({ client });

    await expect(vision.analyze({ image: Buffer.alloc(0), mimeType: 'image/jpeg' }))
      .rejects.toThrow('camera_vision_input_invalid');
    await expect(vision.analyze({ image: Buffer.from('jpeg'), mimeType: 'image/jpeg' }))
      .rejects.toThrow('camera_vision_empty_result');
  });

  it('defaults to the current stable multimodal Gemini model', async () => {
    const client = { models: { generateContent: vi.fn(async () => ({ text: 'Scène visible.' })) } };
    const vision = createGeminiCameraVision({ client });

    await vision.analyze({ image: Buffer.from('jpeg'), mimeType: 'image/jpeg' });

    expect(client.models.generateContent).toHaveBeenCalledWith(expect.objectContaining({ model: 'gemini-3.1-flash-lite' }));
  });

  it('analyzes the camera frame through an OpenAI-compatible multimodal endpoint', async () => {
    const client = { chat: { completions: { create: vi.fn(async () => ({
      choices: [{ message: { content: 'Je vois un bureau.' } }],
    })) } } };
    const vision = createOpenAiCompatibleCameraVision({
      id: 'modal-camera-vision', client, model: 'Qwen/Qwen3.5-9B',
    });

    await expect(vision.analyze({
      image: Buffer.from('jpeg'), mimeType: 'image/jpeg', prompt: 'Que vois-tu ?',
    })).resolves.toEqual({ text: 'Je vois un bureau.', modelId: 'Qwen/Qwen3.5-9B' });
    expect(client.chat.completions.create).toHaveBeenCalledWith(expect.objectContaining({
      model: 'Qwen/Qwen3.5-9B',
      messages: [expect.objectContaining({
        content: expect.arrayContaining([expect.objectContaining({ type: 'image_url' })]),
      })],
    }));
  });

  it('falls back between vision providers and respects local-only mode', async () => {
    const cloudFailure = { id: 'gemini', locality: 'cloud', analyze: vi.fn(async () => { throw new Error('quota'); }) };
    const cloudFallback = { id: 'openrouter', locality: 'cloud', analyze: vi.fn(async () => ({ text: 'cloud', modelId: 'vision' })) };
    const local = { id: 'lm-studio', locality: 'local', analyze: vi.fn(async () => ({ text: 'local', modelId: 'local-vl' })) };

    const automatic = createRoutedCameraVision({ providers: [cloudFailure, cloudFallback, local], mode: 'auto' });
    await expect(automatic.analyze({ image: Buffer.from('jpeg'), mimeType: 'image/jpeg' }))
      .resolves.toMatchObject({ text: 'cloud', providerId: 'openrouter' });

    const localOnly = createRoutedCameraVision({ providers: [cloudFailure, local], mode: 'local-only' });
    await expect(localOnly.analyze({ image: Buffer.from('jpeg'), mimeType: 'image/jpeg' }))
      .resolves.toMatchObject({ text: 'local', providerId: 'lm-studio' });
    expect(cloudFailure.analyze).toHaveBeenCalledTimes(1);
  });
});
