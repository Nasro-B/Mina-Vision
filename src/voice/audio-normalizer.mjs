import { createHash } from 'node:crypto';

const TARGET_RATE = 16_000;

function wavFormat(bytes) {
  if (bytes.length < 12 || bytes.toString('ascii', 0, 4) !== 'RIFF'
    || bytes.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('audio_wav_invalid');
  }
  let format = null;
  let data = null;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const id = bytes.toString('ascii', offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + size;
    if (end > bytes.length) throw new Error('audio_wav_invalid');
    if (id === 'fmt ' && !format) {
      if (size < 16) throw new Error('audio_wav_invalid');
      format = {
        encoding: bytes.readUInt16LE(start),
        channels: bytes.readUInt16LE(start + 2),
        sampleRate: bytes.readUInt32LE(start + 4),
        blockAlign: bytes.readUInt16LE(start + 12),
        bitsPerSample: bytes.readUInt16LE(start + 14),
      };
    } else if (id === 'data' && !data) {
      data = bytes.subarray(start, end);
    }
    offset = end + (size % 2);
  }
  if (!format || !data || format.encoding !== 1 || ![1, 2].includes(format.channels)
    || format.sampleRate < 1 || format.sampleRate > 192_000 || format.bitsPerSample !== 16
    || format.blockAlign !== format.channels * 2 || data.length % format.blockAlign !== 0) {
    throw new Error('audio_wav_invalid');
  }
  return { ...format, data };
}

function pcmFormat(bytes, mimeType) {
  const match = String(mimeType).match(/^audio\/pcm\s*;\s*rate=(\d+)$/iu);
  if (!match || bytes.length === 0 || bytes.length % 2 !== 0) throw new Error('audio_pcm_invalid');
  const sampleRate = Number(match[1]);
  if (!Number.isSafeInteger(sampleRate) || sampleRate < 1 || sampleRate > 192_000) {
    throw new Error('audio_pcm_invalid');
  }
  return { encoding: 1, channels: 1, sampleRate, blockAlign: 2, bitsPerSample: 16, data: bytes };
}

function sampleAt(data, frame, channels) {
  let sum = 0;
  const offset = frame * channels * 2;
  for (let channel = 0; channel < channels; channel += 1) {
    sum += data.readInt16LE(offset + channel * 2);
  }
  return sum / channels;
}

function assertNotSilent(data) {
  let peak = 0;
  for (let offset = 0; offset < data.length; offset += 2) {
    peak = Math.max(peak, Math.abs(data.readInt16LE(offset)));
    if (peak >= 8) return;
  }
  throw new Error('audio_silence');
}

function convertToMono16k({ data, channels, sampleRate, frameCount }) {
  const targetFrames = Math.max(1, Math.round((frameCount * TARGET_RATE) / sampleRate));
  const output = Buffer.allocUnsafe(targetFrames * 2);
  for (let index = 0; index < targetFrames; index += 1) {
    const position = (index * sampleRate) / TARGET_RATE;
    const left = Math.min(frameCount - 1, Math.floor(position));
    const right = Math.min(frameCount - 1, left + 1);
    const ratio = Math.min(1, position - left);
    const value = sampleAt(data, left, channels) * (1 - ratio) + sampleAt(data, right, channels) * ratio;
    output.writeInt16LE(Math.max(-32_768, Math.min(32_767, Math.round(value))), index * 2);
  }
  return output;
}

export function normalizeAudio({ bytes, mimeType, maxSeconds = 30 } = {}) {
  const source = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes ?? []);
  if (!Number.isFinite(maxSeconds) || maxSeconds <= 0 || maxSeconds > 3_600) {
    throw new TypeError('audio_max_seconds_invalid');
  }
  const format = /^(?:audio\/wav|audio\/x-wav)$/iu.test(String(mimeType))
    ? wavFormat(source)
    : pcmFormat(source, mimeType);
  const frameCount = format.data.length / format.blockAlign;
  const durationSeconds = frameCount / format.sampleRate;
  if (durationSeconds > maxSeconds) throw new Error('audio_duration_limit');
  assertNotSilent(format.data);
  const pcm = convertToMono16k({ ...format, frameCount });
  return Object.freeze({
    pcm,
    size: pcm.length,
    sampleRate: TARGET_RATE,
    channels: 1,
    durationSeconds,
    digest: `sha256:${createHash('sha256').update(pcm).digest('hex')}`,
  });
}
