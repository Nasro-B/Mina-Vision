import { describe, expect, it } from 'vitest';
import {
  VOICE_CHUNK_BYTES,
  VOICE_MAX_BYTES,
  VOICE_PCM_MIME,
  VOICE_SAMPLE_RATE_HZ,
  isVoicePcmMime,
  pcm16leToFloat32,
} from '../src/chat/voice-pcm.mjs';
import { createMediaAssembler } from '../src/chat/media-assembler.mjs';
import { chunkMedia } from '../src/chat/media-chunker.mjs';

const voiceMeta = (overrides = {}) => ({
  mediaId: 'voice-pcm-1',
  mime: VOICE_PCM_MIME,
  sizeBytes: VOICE_MAX_BYTES,
  sha256: 'a'.repeat(64),
  chunkCount: Math.ceil(VOICE_MAX_BYTES / VOICE_CHUNK_BYTES),
  chunkBytes: VOICE_CHUNK_BYTES,
  ...overrides,
});

describe('voice PCM contract', () => {
  it('uses the fixed 16 kHz mono PCM16 contract', () => {
    expect(VOICE_PCM_MIME).toBe('audio/L16;rate=16000;channels=1');
    expect(VOICE_SAMPLE_RATE_HZ).toBe(16_000);
    expect(VOICE_CHUNK_BYTES).toBe(32_000);
    expect(VOICE_MAX_BYTES).toBe(50 * 1024 * 1024);
    expect(isVoicePcmMime(VOICE_PCM_MIME)).toBe(true);
    expect(isVoicePcmMime('audio/L16;rate=8000;channels=1')).toBe(false);
  });

  it('converts signed little-endian PCM16 without renderer decoding', () => {
    expect(pcm16leToFloat32(Buffer.from([0x00, 0x80, 0xff, 0x7f])))
      .toEqual(new Float32Array([-1, 32767 / 32768]));
  });

  it('accepts exactly 50 MiB only for canonical PCM', () => {
    const assembler = createMediaAssembler();
    expect(assembler.begin(voiceMeta())).toMatchObject({ mediaId: 'voice-pcm-1' });
    expect(() => assembler.begin(voiceMeta({ sizeBytes: VOICE_MAX_BYTES + 1 }))).toThrow('media_taille_invalide');
    expect(() => assembler.begin({
      ...voiceMeta(),
      mediaId: 'image-too-large',
      mime: 'image/jpeg',
    })).toThrow('media_taille_invalide');
  });

  it('does not allow an injected option to raise the hard PCM cap', () => {
    const assembler = createMediaAssembler({ maxVoiceBytes: VOICE_MAX_BYTES + 1 });
    expect(() => assembler.begin(voiceMeta({ sizeBytes: VOICE_MAX_BYTES + 1 })))
      .toThrow('media_taille_invalide');
  });

  it('does not allow the sender option to raise the hard PCM cap', () => {
    expect(() => chunkMedia(Buffer.alloc(VOICE_MAX_BYTES + 1), {
      mime: VOICE_PCM_MIME,
      maxTotalBytes: Number.MAX_SAFE_INTEGER,
    })).toThrow('media_trop_gros');
  });

  it('rejects an odd PCM16 byte length before conversion', () => {
    expect(() => pcm16leToFloat32(Buffer.from([1]))).toThrow('voice_pcm_invalide');
  });
});
