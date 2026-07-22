async function loadTransformersEmbedder(manifest) {
  const transformers = await import('@huggingface/transformers');
  transformers.env.allowRemoteModels = false;
  transformers.env.allowLocalModels = true;
  const extractor = await transformers.pipeline('feature-extraction', manifest.localPath, {
    local_files_only: true,
  });
  return Object.freeze({
    async embed(text) {
      const output = await extractor(String(text), { pooling: 'mean', normalize: true });
      return Float32Array.from(output.data ?? output);
    },
  });
}

export function createLocalEmbedder({ modelRegistry, loader = loadTransformersEmbedder } = {}) {
  if (!modelRegistry?.resolve || typeof loader !== 'function') {
    throw new TypeError('local_embedder_dependencies_required');
  }
  let loaded;

  async function resolveModel() {
    const manifest = await modelRegistry.resolve('embedding', { installed: true, localOnly: true });
    const state = manifest?.state ?? manifest?.status;
    const localPath = manifest?.installPath ?? manifest?.localPath;
    if (!manifest || !['installed', 'loaded'].includes(state) || manifest.digestValidated === false || !localPath) {
      throw new Error('embedding_model_unavailable');
    }
    return loader({ ...manifest, localPath }, { allowRemoteModels: false, localFilesOnly: true });
  }

  async function embed(text) {
    loaded ??= resolveModel();
    const model = await loaded;
    const vector = await model.embed(String(text));
    const normalized = vector instanceof Float32Array ? vector : Float32Array.from(vector ?? []);
    if (normalized.length === 0 || [...normalized].some((value) => !Number.isFinite(value))) {
      throw new Error('invalid_embedding_vector');
    }
    return normalized;
  }

  return Object.freeze({ embed });
}
