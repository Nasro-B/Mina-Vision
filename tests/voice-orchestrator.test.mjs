import { describe, expect, it, vi } from 'vitest';
import { createVoiceOrchestrator } from '../src/voice/voice-orchestrator.mjs';

const normalizedAudio = Object.freeze({
  pcm: Buffer.from([100, 0]), sampleRate: 16_000, channels: 1,
  durationSeconds: 0.1, digest: `sha256:${'a'.repeat(64)}`,
});
const sttRoute = Object.freeze({ providerId: 'local-stt', capability: 'voice.transcribe' });
const ttsRoute = Object.freeze({ providerId: 'local-tts', capability: 'voice.synthesize' });

function setup({ transcripts = ['Salut Mina, donne l’heure'], ttsInvoke, respond } = {}) {
  const events = [];
  const capabilityRouter = {
    resolve: vi.fn(({ capability }) => capability === 'voice.transcribe' ? [sttRoute] : [ttsRoute]),
  };
  const providerRegistry = {
    invoke: vi.fn(async (route, input) => {
      if (route === sttRoute) {
        return {
          text: transcripts.shift(), language: 'fr', isFinal: true, segments: [], modelId: 'stt-fixture',
          usage: { audioSeconds: 0.1, completeness: 'final' },
        };
      }
      if (ttsInvoke) return ttsInvoke(input);
      return {
        audio: Buffer.from([1, 0]), mimeType: 'audio/pcm;rate=24000', sampleRate: 24_000,
        durationSeconds: 0.2, isFinal: true, modelId: 'tts-fixture',
        usage: { audioSeconds: 0.2, completeness: 'final' },
      };
    }),
  };
  const value = createVoiceOrchestrator({
    capabilityRouter,
    providerRegistry,
    respond: respond ?? vi.fn(async () => ({ text: 'Il est midi.' })),
    audioNormalizer: vi.fn(() => normalizedAudio),
    idFactory: () => 'voice-1',
    onEvent: (event) => events.push(event),
  });
  return { value, events, capabilityRouter, providerRegistry };
}

describe('voice orchestrator', () => {
  it('routes STT/TTS independently and emits a complete grounded session', async () => {
    const respond = vi.fn(async () => ({ text: 'Il est midi.' }));
    const { value, events, capabilityRouter, providerRegistry } = setup({ respond });
    const started = value.start({ mode: 'local-only' });

    const result = await value.pushAudio({
      sessionId: started.id,
      bytes: Buffer.from([1, 2]),
      mimeType: 'audio/pcm;rate=16000',
    });

    expect(result).toMatchObject({ transcript: 'Salut Mina, donne l’heure', response: 'Il est midi.' });
    expect(respond).toHaveBeenCalledWith(expect.objectContaining({ command: 'donne l’heure', channel: 'voice' }));
    expect(capabilityRouter.resolve).toHaveBeenCalledWith(expect.objectContaining({
      capability: 'voice.transcribe', mode: 'local-only', offline: false,
    }));
    expect(capabilityRouter.resolve).toHaveBeenCalledWith(expect.objectContaining({
      capability: 'voice.synthesize', mode: 'local-only', offline: false,
    }));
    expect(providerRegistry.invoke.mock.calls.map(([route]) => route.providerId)).toEqual(['local-stt', 'local-tts']);
    expect(events.map(({ type }) => type)).toEqual(expect.arrayContaining([
      'session_start', 'voice_transcript', 'voice_wake', 'voice_command', 'voice_audio', 'session_end',
    ]));
    expect(JSON.stringify(events)).not.toContain('"pcm"');
    expect(value.status(started.id)).toMatchObject({ state: 'idle', ended: true, endReason: 'completed' });
  });

  it('treats a wake phrase as activation only and waits for a command', async () => {
    const respond = vi.fn(async () => ({ text: 'D’accord.' }));
    const { value } = setup({ transcripts: ['Bonjour Mina', 'ouvre le calendrier'], respond });
    const session = value.start({ mode: 'local-only' });

    await value.pushAudio({ sessionId: session.id, bytes: Buffer.from([1, 2]), mimeType: 'audio/pcm;rate=16000' });

    expect(respond).not.toHaveBeenCalled();
    expect(value.status(session.id)).toMatchObject({ state: 'listening', activated: true });

    await value.pushAudio({ sessionId: session.id, bytes: Buffer.from([1, 2]), mimeType: 'audio/pcm;rate=16000' });
    expect(respond).toHaveBeenCalledWith(expect.objectContaining({ command: 'ouvre le calendrier' }));
  });

  it('stops on provider failure without storing raw audio', async () => {
    const { value, events, providerRegistry } = setup();
    providerRegistry.invoke.mockRejectedValueOnce(new Error('stt_failed'));
    const session = value.start({ mode: 'local-only' });

    await expect(value.pushAudio({
      sessionId: session.id, bytes: Buffer.from([1, 2]), mimeType: 'audio/pcm;rate=16000',
    })).rejects.toThrow('stt_failed');

    expect(value.status(session.id)).toMatchObject({ state: 'idle', ended: true, endReason: 'failure' });
    expect(events).toContainEqual(expect.objectContaining({ type: 'voice_failure', reason: 'stt_failed' }));
    expect(JSON.stringify(events)).not.toContain('"bytes"');
  });

  it('supports barge-in while TTS is speaking', async () => {
    let announceTts;
    const ttsStarted = new Promise((resolve) => { announceTts = resolve; });
    const ttsInvoke = ({ signal }) => new Promise((resolve, reject) => {
      announceTts();
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    });
    const { value } = setup({ ttsInvoke });
    const session = value.start({ mode: 'local-only' });
    const pending = value.pushAudio({
      sessionId: session.id, bytes: Buffer.from([1, 2]), mimeType: 'audio/pcm;rate=16000',
    });
    await ttsStarted;

    value.bargeIn(session.id);

    await expect(pending).resolves.toMatchObject({ interrupted: true });
    expect(value.status(session.id)).toMatchObject({ state: 'listening', ended: false });
  });
});
