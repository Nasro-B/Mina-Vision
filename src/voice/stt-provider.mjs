function validSegment(segment) {
  return typeof segment?.text === 'string' && segment.text.length <= 10_000
    && Number.isFinite(segment.startSeconds) && segment.startSeconds >= 0
    && Number.isFinite(segment.endSeconds) && segment.endSeconds >= segment.startSeconds
    && Number.isFinite(segment.confidence) && segment.confidence >= 0 && segment.confidence <= 1;
}

export function normalizeSttRequest({ audio, language = 'fr', autoDetect = false, signal } = {}) {
  signal?.throwIfAborted();
  if (!Buffer.isBuffer(audio?.pcm) || audio.pcm.length === 0 || audio.pcm.length % 2 !== 0
    || audio.sampleRate !== 16_000 || audio.channels !== 1
    || !Number.isFinite(audio.durationSeconds) || audio.durationSeconds <= 0
    || !/^sha256:[a-f0-9]{64}$/u.test(audio.digest ?? '')) {
    throw new TypeError('stt_audio_invalid');
  }
  if (language === 'auto' && autoDetect !== true) throw new Error('stt_auto_detection_not_allowed');
  if (language !== 'auto' && !/^[a-z]{2,3}(?:-[A-Z]{2})?$/u.test(language)) throw new TypeError('stt_language_invalid');
  return Object.freeze({ audio, language, autoDetect: autoDetect === true, signal });
}

export function normalizeSttResult(result) {
  if (typeof result?.text !== 'string' || result.text.length > 100_000
    || typeof result.language !== 'string' || result.language.length > 20
    || !Array.isArray(result.segments) || result.segments.length > 10_000
    || !result.segments.every(validSegment) || !result.usage || typeof result.modelId !== 'string') {
    throw new Error('stt_result_invalid');
  }
  return Object.freeze({
    ...result,
    segments: Object.freeze(result.segments.map((segment) => Object.freeze({ ...segment }))),
    usage: Object.freeze({ ...result.usage }),
  });
}

export function createSttProvider({ transcribe } = {}) {
  if (typeof transcribe !== 'function') throw new TypeError('stt_transcribe_required');
  return Object.freeze({
    transcribe: async (request) => normalizeSttResult(await transcribe(normalizeSttRequest(request))),
  });
}
