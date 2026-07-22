import { createSttProvider } from '../voice/stt-provider.mjs';

export function createLocalSttProvider({
  modelRegistry,
  modelLoader,
  clock = performance.now.bind(performance),
} = {}) {
  if (!modelRegistry?.resolve || !modelLoader?.load) throw new TypeError('local_stt_dependencies_required');

  const port = createSttProvider({
    transcribe: async ({ audio, language, autoDetect, signal }) => {
      signal?.throwIfAborted();
      const model = modelRegistry.resolve('stt', { localOnly: true });
      const pipeline = await modelLoader.load('stt');
      const transcribe = pipeline.transcribe ?? pipeline.run;
      if (typeof transcribe !== 'function') throw new Error('local_stt_pipeline_invalid');
      const started = Number(clock());
      const raw = await transcribe({
        audio: audio.pcm,
        sampleRate: audio.sampleRate,
        language,
        autoDetect,
        signal,
      });
      signal?.throwIfAborted();
      const partial = raw?.partial === true;
      return {
        text: raw?.text,
        language: raw?.language ?? (language === 'auto' ? 'und' : language),
        segments: raw?.segments ?? [],
        isFinal: !partial,
        modelId: model.id,
        usage: {
          audioSeconds: audio.durationSeconds,
          localComputeMs: Math.max(0, Number(clock()) - started),
          completeness: partial ? 'partial' : 'final',
        },
      };
    },
  });

  function health() {
    try {
      modelRegistry.resolve('stt', { localOnly: true });
      return Object.freeze({ available: true });
    } catch (error) {
      return Object.freeze({ available: false, reason: error.message });
    }
  }

  const transcribe = (request) => port.transcribe(request);
  return Object.freeze({
    id: 'local-stt', locality: 'local', network: 'none',
    capabilities: Object.freeze(['voice.transcribe']), health,
    transcribe, invoke: transcribe,
  });
}
