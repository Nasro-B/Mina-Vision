import { describe, expect, it, vi } from 'vitest';
import { createLocalSttProvider } from '../src/providers/local-stt.mjs';
import { createLocalTtsProvider } from '../src/providers/local-tts.mjs';

const audio = Object.freeze({
  pcm: Buffer.from([100, 0, 200, 0]), sampleRate: 16_000, channels: 1,
  durationSeconds: 0.25, digest: `sha256:${'a'.repeat(64)}`,
});

function registry() {
  return { resolve: vi.fn((role) => ({ id: `fixture-${role}` })) };
}

describe('local voice provider contracts', () => {
  it('transcribes in French by default with actual model and final usage', async () => {
    const transcribe = vi.fn(async () => ({
      text: 'Salut Mina',
      language: 'fr',
      segments: [{ text: 'Salut Mina', startSeconds: 0, endSeconds: 0.25, confidence: 0.98 }],
      partial: false,
    }));
    const modelLoader = { load: vi.fn(async () => ({ transcribe })) };
    const provider = createLocalSttProvider({ modelRegistry: registry(), modelLoader, clock: () => 42 });

    const result = await provider.transcribe({ audio });

    expect(transcribe).toHaveBeenCalledWith(expect.objectContaining({ language: 'fr', sampleRate: 16_000 }));
    expect(modelLoader.load).toHaveBeenCalledWith('stt');
    expect(result).toMatchObject({
      text: 'Salut Mina', language: 'fr', isFinal: true, modelId: 'fixture-stt',
      usage: { audioSeconds: 0.25, completeness: 'final' },
    });
  });

  it('requires opt-in for language auto-detection and preserves partial STT output', async () => {
    const provider = createLocalSttProvider({
      modelRegistry: registry(),
      modelLoader: { load: async () => ({ transcribe: async () => ({ text: 'Bon', language: 'fr', segments: [], partial: true }) }) },
    });

    await expect(provider.transcribe({ audio, language: 'auto' })).rejects.toThrow('stt_auto_detection_not_allowed');
    await expect(provider.transcribe({ audio, language: 'auto', autoDetect: true })).resolves.toMatchObject({
      text: 'Bon', isFinal: false, usage: { completeness: 'partial' },
    });
  });

  it('synthesizes bounded PCM16 with partial/final usage metadata', async () => {
    const synthesize = vi.fn(async () => ({
      audio: Buffer.from([1, 0, 2, 0]), sampleRate: 24_000,
      mimeType: 'audio/pcm;rate=24000', durationSeconds: 0.5, partial: true,
    }));
    const modelLoader = { load: vi.fn(async () => ({ synthesize })) };
    const provider = createLocalTtsProvider({ modelRegistry: registry(), modelLoader, clock: () => 10 });

    const result = await provider.synthesize({ text: 'Bonjour', voice: 'mina-fr', format: 'pcm16' });

    expect(synthesize).toHaveBeenCalledWith(expect.objectContaining({ text: 'Bonjour', voice: 'mina-fr', format: 'pcm16' }));
    expect(modelLoader.load).toHaveBeenCalledWith('tts');
    expect(result).toMatchObject({
      mimeType: 'audio/pcm;rate=24000', sampleRate: 24_000, isFinal: false, modelId: 'fixture-tts',
      usage: { characters: 7, audioSeconds: 0.5, completeness: 'partial' },
    });
  });

  it('honours cancellation before loading either heavy model', async () => {
    const controller = new AbortController();
    controller.abort();
    const sttLoader = { load: vi.fn() };
    const ttsLoader = { load: vi.fn() };
    const stt = createLocalSttProvider({ modelRegistry: registry(), modelLoader: sttLoader });
    const tts = createLocalTtsProvider({ modelRegistry: registry(), modelLoader: ttsLoader });

    await expect(stt.transcribe({ audio, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    await expect(tts.synthesize({ text: 'Bonjour', signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(sttLoader.load).not.toHaveBeenCalled();
    expect(ttsLoader.load).not.toHaveBeenCalled();
  });
});
