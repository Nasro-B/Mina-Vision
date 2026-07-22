const PIPELINE_TASKS = Object.freeze({
  text: 'text-generation', reasoning: 'text-generation', embedding: 'feature-extraction',
  ocr: 'image-to-text', vision: 'image-to-text', stt: 'automatic-speech-recognition',
  tts: 'text-to-speech', 'computer-use': 'image-text-to-text',
  'face-detection': 'object-detection', 'face-recognition': 'image-feature-extraction',
});

async function defaultLoadPipeline(model) {
  if (model.runtime !== 'transformers-js') throw new Error(`model_runtime_loader_missing:${model.runtime}`);
  const { pipeline } = await import('@huggingface/transformers');
  const instance = await pipeline(PIPELINE_TASKS[model.role], model.installPath, {
    local_files_only: true,
  });
  return Object.freeze({
    id: model.id,
    run: (input, options) => instance(input, options),
    unload: async () => instance.dispose?.(),
  });
}

export function createModelLoader({
  modelRegistry,
  loadPipeline = defaultLoadPipeline,
  maxLoadedRamMb = 8_000,
} = {}) {
  if (!modelRegistry?.resolve || !modelRegistry?.markLoaded || !modelRegistry?.markFailed
    || typeof loadPipeline !== 'function') {
    throw new TypeError('model_loader_dependencies_required');
  }
  let current = null;

  async function unloadCurrent() {
    if (!current) return;
    const previous = current;
    current = null;
    await (previous.instance.unload?.() ?? previous.instance.dispose?.());
    modelRegistry.markInstalled?.(previous.model.id, previous.model.installPath);
  }

  async function load(role, options = {}) {
    if (options.trust_remote_code === true || options.trustRemoteCode === true) {
      throw new Error('remote_model_code_forbidden');
    }
    const model = modelRegistry.resolve(role, options.constraints ?? {});
    if (model.estimatedRamMb > maxLoadedRamMb) throw new Error(`model_ram_limit_exceeded:${model.id}`);
    if (current?.model.id === model.id) return current.instance;
    await unloadCurrent();
    try {
      const instance = await loadPipeline(model, { ...options, trust_remote_code: false, local_files_only: true });
      if (!instance || typeof instance !== 'object') throw new Error('model_pipeline_invalid');
      current = { model, instance };
      modelRegistry.markLoaded(model.id);
      return instance;
    } catch (error) {
      modelRegistry.markFailed(model.id, error);
      throw error;
    }
  }

  function status() {
    return Object.freeze({
      loaded: current?.model.id ?? null,
      estimatedRamMb: current?.model.estimatedRamMb ?? 0,
    });
  }

  return Object.freeze({ load, unload: unloadCurrent, handleMemoryPressure: unloadCurrent, status });
}
