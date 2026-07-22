export function createLocalEmbeddingProvider({ modelRegistry, modelLoader, clock = performance.now.bind(performance) } = {}) {
  if (!modelRegistry?.resolve || !modelLoader?.load) throw new TypeError('local_embedding_dependencies_required');

  async function embed({ texts } = {}) {
    if (!Array.isArray(texts) || texts.length === 0 || texts.length > 256
      || texts.some((text) => typeof text !== 'string' || text.length > 32_000)) {
      throw new TypeError('local_embedding_input_invalid');
    }
    const model = modelRegistry.resolve('embedding', { localOnly: true });
    const pipeline = await modelLoader.load('embedding');
    if (typeof pipeline.embed !== 'function') throw new Error('local_embedding_pipeline_invalid');
    const started = Number(clock());
    const vectors = [];
    let dimensions = null;
    for (const text of texts) {
      const vector = Float32Array.from(await pipeline.embed(text));
      if (vector.length === 0 || [...vector].some((value) => !Number.isFinite(value))
        || (dimensions !== null && vector.length !== dimensions)) {
        throw new Error('local_embedding_invalid');
      }
      dimensions ??= vector.length;
      vectors.push(vector);
    }
    return Object.freeze({
      vectors: Object.freeze(vectors),
      dimensions,
      modelId: model.id,
      usage: Object.freeze({ inputTexts: texts.length, localComputeMs: Math.max(0, Number(clock()) - started) }),
    });
  }

  return Object.freeze({
    id: 'local-embedding', locality: 'local', network: 'none',
    capabilities: Object.freeze(['embedding.generate']),
    health: () => Object.freeze({ available: true }),
    embed,
    invoke: embed,
  });
}
