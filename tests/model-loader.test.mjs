import { describe, expect, it, vi } from 'vitest';
import { createModelLoader } from '../src/models/model-loader.mjs';

function registry() {
  const models = {
    text: { id: 'text-small', role: 'text', runtime: 'transformers-js', installPath: 'C:\\models\\text-small', estimatedRamMb: 2_000, state: 'installed' },
    ocr: { id: 'ocr-small', role: 'ocr', runtime: 'onnx', installPath: 'C:\\models\\ocr-small', estimatedRamMb: 800, state: 'installed' },
  };
  return {
    resolve: vi.fn((role) => models[role]),
    markLoaded: vi.fn((id) => ({ id, state: 'loaded' })),
    markInstalled: vi.fn(),
    markFailed: vi.fn(),
  };
}

describe('single-heavy-model loader', () => {
  it('loads dynamically, reuses the current model and unloads it before another role', async () => {
    const modelRegistry = registry();
    const unload = vi.fn(async () => {});
    const loadPipeline = vi.fn(async (model) => ({ id: model.id, unload }));
    const loader = createModelLoader({ modelRegistry, loadPipeline, maxLoadedRamMb: 4_000 });

    const first = await loader.load('text');
    expect(await loader.load('text')).toBe(first);
    await loader.load('ocr');
    expect(unload).toHaveBeenCalledOnce();
    expect(loadPipeline.mock.calls.map(([model]) => model.id)).toEqual(['text-small', 'ocr-small']);
    await loader.handleMemoryPressure();
    expect(loader.status()).toEqual({ loaded: null, estimatedRamMb: 0 });
  });

  it('rejects remote code and RAM overflow and marks loader failures', async () => {
    const modelRegistry = registry();
    const loader = createModelLoader({ modelRegistry, loadPipeline: async () => { throw new Error('load crash'); }, maxLoadedRamMb: 1_000 });
    await expect(loader.load('text')).rejects.toThrow('model_ram_limit_exceeded');
    await expect(loader.load('ocr', { trust_remote_code: true })).rejects.toThrow('remote_model_code_forbidden');

    const failing = createModelLoader({ modelRegistry, loadPipeline: async () => { throw new Error('load crash'); }, maxLoadedRamMb: 4_000 });
    await expect(failing.load('ocr')).rejects.toThrow('load crash');
    expect(modelRegistry.markFailed).toHaveBeenCalledWith('ocr-small', expect.any(Error));
  });
});
