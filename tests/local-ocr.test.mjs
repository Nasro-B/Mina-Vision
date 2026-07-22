import { describe, expect, it, vi } from 'vitest';
import { createLocalOcrProvider } from '../src/providers/local-ocr.mjs';

describe('local OCR provider', () => {
  it('returns bounded text, boxes, confidence, model and compute usage', async () => {
    const modelRegistry = { resolve: vi.fn(() => ({ id: 'ocr-fr', state: 'installed' })) };
    const pipeline = { recognize: vi.fn(async () => ({
      text: 'Recette gâteau', blocks: [{ text: 'Recette', box: [12, 8, 82, 31], confidence: 0.97 }],
    })) };
    const provider = createLocalOcrProvider({ modelRegistry, modelLoader: { load: async () => pipeline }, clock: (() => { let t = 0; return () => (t += 41); })() });

    await expect(provider.recognize({ image: Buffer.from([1, 2]), mimeType: 'image/png' })).resolves.toEqual({
      text: 'Recette gâteau', blocks: [{ text: 'Recette', box: [12, 8, 82, 31], confidence: 0.97 }],
      modelId: 'ocr-fr', usage: { inputImages: 1, localComputeMs: 41 },
    });
  });

  it('rejects malformed boxes and confidence', async () => {
    const provider = createLocalOcrProvider({
      modelRegistry: { resolve: () => ({ id: 'ocr', state: 'installed' }) },
      modelLoader: { load: async () => ({ recognize: async () => ({ text: 'x', blocks: [{ text: 'x', box: [1, 2], confidence: 2 }] }) }) },
    });
    await expect(provider.recognize({ image: Buffer.from([1]), mimeType: 'image/png' })).rejects.toThrow('local_ocr_result_invalid');
  });
});
