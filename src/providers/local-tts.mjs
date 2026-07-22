import { createTtsProvider } from '../voice/tts-provider.mjs';

export function createLocalTtsProvider({
  modelRegistry,
  modelLoader,
  clock = performance.now.bind(performance),
} = {}) {
  if (!modelRegistry?.resolve || !modelLoader?.load) throw new TypeError('local_tts_dependencies_required');

  const port = createTtsProvider({
    synthesize: async ({ text, voice, format, signal }) => {
      signal?.throwIfAborted();
      const model = modelRegistry.resolve('tts', { localOnly: true });
      const pipeline = await modelLoader.load('tts');
      const synthesize = pipeline.synthesize ?? pipeline.run;
      if (typeof synthesize !== 'function') throw new Error('local_tts_pipeline_invalid');
      const started = Number(clock());
      const raw = await synthesize({ text, voice, format, signal });
      signal?.throwIfAborted();
      const partial = raw?.partial === true;
      return {
        audio: Buffer.from(raw?.audio ?? []),
        mimeType: raw?.mimeType,
        sampleRate: raw?.sampleRate,
        durationSeconds: raw?.durationSeconds,
        isFinal: !partial,
        modelId: model.id,
        usage: {
          characters: text.length,
          audioSeconds: raw?.durationSeconds,
          localComputeMs: Math.max(0, Number(clock()) - started),
          completeness: partial ? 'partial' : 'final',
        },
      };
    },
  });

  function health() {
    try {
      modelRegistry.resolve('tts', { localOnly: true });
      return Object.freeze({ available: true });
    } catch (error) {
      return Object.freeze({ available: false, reason: error.message });
    }
  }

  const synthesize = (request) => port.synthesize(request);
  return Object.freeze({
    id: 'local-tts', locality: 'local', network: 'none',
    capabilities: Object.freeze(['voice.synthesize']), health,
    synthesize, invoke: synthesize,
  });
}
