import { describe, expect, it, vi } from 'vitest';
import { createLocalEmbedder } from '../src/rag/local-embedder.mjs';

describe('local embedder', () => {
  it('resolves the embedding role lazily from a digest-validated local manifest', async () => {
    const modelRegistry = {
      resolve: vi.fn(() => ({
        id: 'configured-by-manifest',
        localPath: 'G:/Models/mina-embedder',
        status: 'installed',
        digestValidated: true,
      })),
    };
    const loader = vi.fn(async (_manifest, policy) => ({
      embed: async () => new Float32Array([0.25, 0.75]),
      policy,
    }));
    const embedder = createLocalEmbedder({ modelRegistry, loader });

    expect(loader).not.toHaveBeenCalled();
    expect(await embedder.embed('bonjour Mina')).toEqual(new Float32Array([0.25, 0.75]));
    expect(modelRegistry.resolve).toHaveBeenCalledWith('embedding', { installed: true, localOnly: true });
    expect(loader).toHaveBeenCalledWith(expect.objectContaining({ id: 'configured-by-manifest' }), {
      allowRemoteModels: false,
      localFilesOnly: true,
    });
  });

  it('fails explicitly when no validated local model is installed', async () => {
    const missing = createLocalEmbedder({ modelRegistry: { resolve: () => null }, loader: vi.fn() });
    const invalid = createLocalEmbedder({
      modelRegistry: { resolve: () => ({ status: 'installed', digestValidated: false, localPath: 'x' }) },
      loader: vi.fn(),
    });

    await expect(missing.embed('texte')).rejects.toThrow('embedding_model_unavailable');
    await expect(invalid.embed('texte')).rejects.toThrow('embedding_model_unavailable');
  });
});
