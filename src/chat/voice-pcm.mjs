export const VOICE_PCM_MIME = 'audio/L16;rate=16000;channels=1';
export const VOICE_SAMPLE_RATE_HZ = 16_000;
export const VOICE_CHANNEL_COUNT = 1;
export const VOICE_BYTES_PER_SAMPLE = 2;
export const VOICE_CHUNK_BYTES = VOICE_SAMPLE_RATE_HZ * VOICE_CHANNEL_COUNT * VOICE_BYTES_PER_SAMPLE;
export const VOICE_MAX_BYTES = 50 * 1024 * 1024;

export function isVoicePcmMime(mime) {
  return mime === VOICE_PCM_MIME;
}

export function pcm16leToFloat32(bytes) {
  const source = Buffer.from(bytes ?? []);
  if (source.length === 0 || source.length % VOICE_BYTES_PER_SAMPLE !== 0) {
    throw new Error('voice_pcm_invalide');
  }

  const output = new Float32Array(source.length / VOICE_BYTES_PER_SAMPLE);
  for (let offset = 0; offset < source.length; offset += VOICE_BYTES_PER_SAMPLE) {
    output[offset / VOICE_BYTES_PER_SAMPLE] = source.readInt16LE(offset) / 32768;
  }
  return output;
}
