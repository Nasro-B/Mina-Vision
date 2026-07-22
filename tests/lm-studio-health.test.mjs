import { describe, expect, it, vi } from 'vitest';
import { probeLmStudio } from '../src/diagnostics/lm-studio-health.mjs';

const config = Object.freeze({
  baseUrl: 'http://127.0.0.1:1234/v1',
  model: 'google/gemma-4-e2b',
  visionModel: 'google/gemma-4-e2b',
  embeddingModel: 'text-embedding-nomic-embed-text-v1.5',
});

function nativeModels({ loaded = true, vision = true } = {}) {
  return {
    models: [
      {
        type: 'llm', key: config.model,
        loaded_instances: loaded ? [{ id: config.model }] : [],
        capabilities: { vision, trained_for_tool_use: true },
      },
      {
        type: 'embedding', key: config.embeddingModel,
        loaded_instances: [{ id: config.embeddingModel }],
      },
    ],
  };
}

describe('LM Studio live health probe', () => {
  it('verifies that text, vision and embedding models are loaded', async () => {
    const fetchImpl = vi.fn(async () => Response.json(nativeModels()));

    await expect(probeLmStudio({ config, fetchImpl })).resolves.toMatchObject({
      ready: true,
      text: { model: config.model, loaded: true },
      vision: { model: config.visionModel, loaded: true },
      embedding: { model: config.embeddingModel, loaded: true },
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:1234/api/v1/models', expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('reports an unloaded model and a missing vision capability', async () => {
    await expect(probeLmStudio({
      config,
      fetchImpl: async () => Response.json(nativeModels({ loaded: false, vision: false })),
    })).resolves.toMatchObject({ ready: false, reason: 'lm_studio_models_not_ready' });
  });

  it('rejects a non-loopback LM Studio URL before opening a socket', async () => {
    const fetchImpl = vi.fn();
    await expect(probeLmStudio({
      config: { ...config, baseUrl: 'http://192.168.1.12:1234/v1' }, fetchImpl,
    })).rejects.toThrow('lm_studio_loopback_required');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
