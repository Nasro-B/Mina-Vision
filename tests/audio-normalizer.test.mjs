import { describe, expect, it } from 'vitest';
import { normalizeAudio } from '../src/voice/audio-normalizer.mjs';

function wav({ sampleRate = 16_000, channels = 1, samples = [] } = {}) {
  const pcm = Buffer.alloc(samples.length * 2);
  samples.forEach((sample, index) => pcm.writeInt16LE(sample, index * 2));
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * 2, 28);
  header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

describe('audio normalizer', () => {
  it('parses PCM16 WAV and returns grounded mono 16 kHz audio', () => {
    const bytes = wav({ samples: [100, -200, 300, -400] });

    const result = normalizeAudio({ bytes, mimeType: 'audio/wav', maxSeconds: 2 });

    expect(result).toMatchObject({ sampleRate: 16_000, channels: 1, durationSeconds: 4 / 16_000 });
    expect([...new Int16Array(result.pcm.buffer, result.pcm.byteOffset, result.pcm.byteLength / 2)])
      .toEqual([100, -200, 300, -400]);
    expect(result.digest).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });

  it('mixes stereo and resamples 8 kHz input to 16 kHz', () => {
    const bytes = wav({
      sampleRate: 8_000,
      channels: 2,
      samples: [1_000, 3_000, 2_000, 4_000, 3_000, 5_000, 4_000, 6_000],
    });

    const result = normalizeAudio({ bytes, mimeType: 'audio/x-wav', maxSeconds: 2 });

    expect(result.pcm.byteLength).toBe(8 * 2);
    const samples = [...new Int16Array(result.pcm.buffer, result.pcm.byteOffset, result.pcm.byteLength / 2)];
    expect(samples[0]).toBe(2_000);
    expect(samples.at(-1)).toBeGreaterThanOrEqual(4_000);
  });

  it('accepts bounded raw PCM16 with an explicit rate', () => {
    const bytes = Buffer.alloc(6);
    bytes.writeInt16LE(100, 0);
    bytes.writeInt16LE(200, 2);
    bytes.writeInt16LE(300, 4);

    expect(normalizeAudio({ bytes, mimeType: 'audio/pcm;rate=16000', maxSeconds: 1 }))
      .toMatchObject({ size: 6, sampleRate: 16_000, channels: 1 });
  });

  it('rejects duration overflow before conversion, silence and malformed input', () => {
    const tooLong = wav({ sampleRate: 2, samples: [100, 100, 100, 100] });
    expect(() => normalizeAudio({ bytes: tooLong, mimeType: 'audio/wav', maxSeconds: 1 }))
      .toThrow('audio_duration_limit');
    expect(() => normalizeAudio({ bytes: wav({ samples: [0, 0, 0] }), mimeType: 'audio/wav', maxSeconds: 1 }))
      .toThrow('audio_silence');
    expect(() => normalizeAudio({ bytes: Buffer.from('not-wave'), mimeType: 'audio/wav', maxSeconds: 1 }))
      .toThrow('audio_wav_invalid');
    expect(() => normalizeAudio({ bytes: Buffer.from([1, 2, 3]), mimeType: 'audio/pcm;rate=16000', maxSeconds: 1 }))
      .toThrow('audio_pcm_invalid');
  });
});
