function validBlock(block) {
  return typeof block?.text === 'string' && block.text.length <= 10_000
    && Array.isArray(block.box) && block.box.length === 4 && block.box.every(Number.isFinite)
    && Number.isFinite(block.confidence) && block.confidence >= 0 && block.confidence <= 1;
}

export function createLocalOcrProvider({ modelRegistry, modelLoader, clock = performance.now.bind(performance) } = {}) {
  if (!modelRegistry?.resolve || !modelLoader?.load) throw new TypeError('local_ocr_dependencies_required');

  async function recognize({ image, mimeType } = {}) {
    const bytes = Buffer.from(image ?? []);
    if (bytes.length === 0 || bytes.length > 25 * 1024 * 1024 || !/^image\/(?:png|jpeg|webp)$/u.test(mimeType ?? '')) {
      throw new TypeError('local_ocr_input_invalid');
    }
    const model = modelRegistry.resolve('ocr', { localOnly: true });
    const pipeline = await modelLoader.load('ocr');
    if (typeof pipeline.recognize !== 'function') throw new Error('local_ocr_pipeline_invalid');
    const started = Number(clock());
    const result = await pipeline.recognize({ image: bytes, mimeType });
    if (typeof result?.text !== 'string' || result.text.length > 100_000
      || !Array.isArray(result.blocks) || result.blocks.length > 10_000 || !result.blocks.every(validBlock)) {
      throw new Error('local_ocr_result_invalid');
    }
    return Object.freeze({
      text: result.text,
      blocks: Object.freeze(result.blocks.map((block) => Object.freeze({ ...block, box: Object.freeze([...block.box]) }))),
      modelId: model.id,
      usage: Object.freeze({ inputImages: 1, localComputeMs: Math.max(0, Number(clock()) - started) }),
    });
  }

  return Object.freeze({
    id: 'local-ocr', locality: 'local', network: 'none',
    capabilities: Object.freeze(['ocr.extract']), health: () => Object.freeze({ available: true }),
    recognize, invoke: recognize,
  });
}
