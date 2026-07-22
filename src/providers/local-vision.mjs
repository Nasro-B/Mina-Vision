function validClaim(claim) {
  return typeof claim?.text === 'string' && claim.text.length > 0 && claim.text.length <= 4_000
    && Number.isFinite(claim.confidence) && claim.confidence >= 0 && claim.confidence <= 1;
}

export function createLocalVisionProvider({ modelRegistry, modelLoader, clock = performance.now.bind(performance) } = {}) {
  if (!modelRegistry?.resolve || !modelLoader?.load) throw new TypeError('local_vision_dependencies_required');

  async function analyze({ image, mimeType, prompt = '' } = {}) {
    const bytes = Buffer.from(image ?? []);
    if (bytes.length === 0 || bytes.length > 25 * 1024 * 1024 || !/^image\/(?:png|jpeg|webp)$/u.test(mimeType ?? '')
      || typeof prompt !== 'string' || prompt.length > 8_000) {
      throw new TypeError('local_vision_input_invalid');
    }
    const model = modelRegistry.resolve('vision', { localOnly: true });
    const pipeline = await modelLoader.load('vision');
    if (typeof pipeline.analyze !== 'function') throw new Error('local_vision_pipeline_invalid');
    const started = Number(clock());
    const result = await pipeline.analyze({ image: bytes, mimeType, prompt });
    if (!result || typeof result === 'string' || !Array.isArray(result.claims) || result.claims.length > 100
      || !result.claims.every(validClaim) || !Number.isFinite(result.uncertainty)
      || result.uncertainty < 0 || result.uncertainty > 1) {
      throw new Error('local_vision_result_invalid');
    }
    return Object.freeze({
      claims: Object.freeze(result.claims.map((claim) => Object.freeze({ ...claim }))),
      uncertainty: result.uncertainty,
      modelId: model.id,
      usage: Object.freeze({ inputImages: 1, localComputeMs: Math.max(0, Number(clock()) - started) }),
    });
  }

  return Object.freeze({
    id: 'local-vision', locality: 'local', network: 'none',
    capabilities: Object.freeze(['vision.analyze', 'vision.classify']), health: () => Object.freeze({ available: true }),
    analyze, invoke: analyze,
  });
}
