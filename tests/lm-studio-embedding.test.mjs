import { describe, expect, it, vi } from 'vitest';
import { createLmStudioEmbeddingProvider } from '../src/providers/lm-studio-embedding.mjs';

describe('LM Studio embedding provider', () => {
  it('returns finite Float32 vectors from the loaded Nomic model', async () => {
    const fetchImpl = vi.fn(async (url, options = {}) => {
      if (String(url).endsWith('/models')) {
        return Response.json({ data: [{ id: 'text-embedding-nomic-embed-text-v1.5' }] });
      }
      expect(JSON.parse(options.body)).toMatchObject({
        model: 'text-embedding-nomic-embed-text-v1.5', input: ['souvenir Mina'],
      });
      return Response.json({ data: [{ embedding: [0.25, -0.5, 0.75] }] });
    });
    const provider = createLmStudioEmbeddingProvider({
      model: 'text-embedding-nomic-embed-text-v1.5', fetchImpl,
    });

    const vector = await provider.embed('souvenir Mina');

    expect(vector).toBeInstanceOf(Float32Array);
    expect([...vector]).toEqual([0.25, -0.5, 0.75]);
    expect(provider.health()).toMatchObject({ available: true });
  });

  it('rejects an unloaded model and malformed vectors', async () => {
    const missing = createLmStudioEmbeddingProvider({
      model: 'nomic', fetchImpl: async () => Response.json({ data: [{ id: 'other' }] }),
    });
    await expect(missing.embed('test')).rejects.toThrow('local_embedding_model_unavailable:nomic');

    const malformed = createLmStudioEmbeddingProvider({
      model: 'nomic',
      fetchImpl: async (url) => String(url).endsWith('/models')
        ? Response.json({ data: [{ id: 'nomic' }] })
        : Response.json({ data: [{ embedding: [1, null] }] }),
    });
    await expect(malformed.embed('test')).rejects.toThrow('local_embedding_vector_invalid');
  });
});
