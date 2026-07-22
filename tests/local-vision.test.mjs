import { describe, expect, it } from 'vitest';
import { createLocalVisionProvider } from '../src/providers/local-vision.mjs';

describe('local vision provider', () => {
  it('returns grounded claims plus explicit uncertainty', async () => {
    const provider = createLocalVisionProvider({
      modelRegistry: { resolve: () => ({ id: 'vision-small', state: 'installed' }) },
      modelLoader: { load: async () => ({ analyze: async () => ({ claims: [{ text: 'Une lampe est visible', confidence: 0.82 }], uncertainty: 0.18 }) }) },
    });
    await expect(provider.analyze({ image: Buffer.from([1]), mimeType: 'image/png', prompt: 'Décris' })).resolves.toMatchObject({
      claims: [{ text: 'Une lampe est visible', confidence: 0.82 }], uncertainty: 0.18, modelId: 'vision-small',
      usage: { inputImages: 1, localComputeMs: expect.any(Number) },
    });
  });

  it('rejects raw success prose and malformed claims', async () => {
    const modelRegistry = { resolve: () => ({ id: 'vision', state: 'installed' }) };
    const raw = createLocalVisionProvider({ modelRegistry, modelLoader: { load: async () => ({ analyze: async () => 'succès' }) } });
    await expect(raw.analyze({ image: Buffer.from([1]), mimeType: 'image/png' })).rejects.toThrow('local_vision_result_invalid');
  });
});
