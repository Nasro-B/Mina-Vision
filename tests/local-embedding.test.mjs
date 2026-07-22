import { describe, expect, it, vi } from 'vitest';
import { createLocalEmbeddingProvider } from '../src/providers/local-embedding.mjs';

describe('local embedding provider', () => {
  it('resolves the embedding role and returns deterministic finite dimensions', async () => {
    const modelRegistry = { resolve: vi.fn(() => ({ id: 'embed-fr', state: 'installed' })) };
    const pipeline = { embed: vi.fn(async (text) => text === 'a' ? [1, 0] : [0, 1]) };
    const provider = createLocalEmbeddingProvider({ modelRegistry, modelLoader: { load: vi.fn(async () => pipeline) } });

    await expect(provider.embed({ texts: ['a', 'b'] })).resolves.toEqual({
      vectors: [new Float32Array([1, 0]), new Float32Array([0, 1])],
      dimensions: 2, modelId: 'embed-fr', usage: { inputTexts: 2, localComputeMs: expect.any(Number) },
    });
    expect(modelRegistry.resolve).toHaveBeenCalledWith('embedding', { localOnly: true });
  });

  it('rejects inconsistent or non-finite vectors', async () => {
    const modelRegistry = { resolve: () => ({ id: 'bad', state: 'installed' }) };
    const provider = createLocalEmbeddingProvider({
      modelRegistry,
      modelLoader: { load: async () => ({ embed: async (text) => text === 'a' ? [1, 2] : [Number.NaN] }) },
    });
    await expect(provider.embed({ texts: ['a', 'b'] })).rejects.toThrow('local_embedding_invalid');
  });
});
