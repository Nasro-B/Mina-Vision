export function normalizeTtsRequest({ text, voice = 'mina-fr', format = 'pcm16', signal } = {}) {
  signal?.throwIfAborted();
  if (typeof text !== 'string' || !text.trim() || text.length > 10_000) throw new TypeError('tts_text_invalid');
  if (typeof voice !== 'string' || !/^[a-z0-9_.-]{1,100}$/iu.test(voice)) throw new TypeError('tts_voice_invalid');
  if (!['pcm16', 'wav'].includes(format)) throw new TypeError('tts_format_invalid');
  return Object.freeze({ text: text.trim(), voice, format, signal });
}

export function normalizeTtsResult(result) {
  if (!Buffer.isBuffer(result?.audio) || result.audio.length === 0 || result.audio.length > 50 * 1024 * 1024
    || !/^audio\/(?:pcm;rate=\d+|wav)$/iu.test(result.mimeType ?? '')
    || !Number.isSafeInteger(result.sampleRate) || result.sampleRate < 8_000 || result.sampleRate > 192_000
    || !Number.isFinite(result.durationSeconds) || result.durationSeconds <= 0
    || !result.usage || typeof result.modelId !== 'string') {
    throw new Error('tts_result_invalid');
  }
  return Object.freeze({ ...result, usage: Object.freeze({ ...result.usage }) });
}

export function createTtsProvider({ synthesize } = {}) {
  if (typeof synthesize !== 'function') throw new TypeError('tts_synthesize_required');
  return Object.freeze({
    synthesize: async (request) => normalizeTtsResult(await synthesize(normalizeTtsRequest(request))),
  });
}
