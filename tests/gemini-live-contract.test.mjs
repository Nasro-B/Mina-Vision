import { describe, expect, it, vi } from 'vitest';
import { createGeminiLiveSession } from '../src/providers/gemini-live.mjs';
import { createInferenceModePolicy } from '../src/routing/inference-mode-policy.mjs';

function transportFixture() {
  let callbacks;
  const session = {
    sendRealtimeInput: vi.fn(async () => {}),
    sendClientContent: vi.fn(async () => {}),
    close: vi.fn(),
  };
  const transport = {
    connect: vi.fn(async (options) => {
      callbacks = options.callbacks;
      return session;
    }),
  };
  return { transport, session, emit: (message) => callbacks.onmessage({ message }) };
}

describe('Gemini Live common voice contract', () => {
  it('emits lifecycle events and partial/final usage metadata', async () => {
    const fixture = transportFixture();
    const events = [];
    const live = createGeminiLiveSession({
      apiKey: 'test',
      transport: fixture.transport,
      onEvent: (event) => events.push(event),
    });

    await live.connect();
    const partial = await live.sendPcm16(Buffer.from([1, 0, 2, 0]));
    fixture.emit({
      serverContent: {
        inputTranscription: { text: 'Salut Mina' },
        modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: 'AQI=' } }] },
        turnComplete: true,
      },
    });
    const final = live.close('completed');

    expect(partial).toMatchObject({ inputAudioBytes: 4, completeness: 'partial' });
    expect(final).toMatchObject({
      inputAudioBytes: 4, outputAudioBytes: 2, transcriptCharacters: 10, completeness: 'final',
    });
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'session_start', providerId: 'gemini-live' }),
      expect.objectContaining({ type: 'voice_transcript', text: 'Salut Mina' }),
      expect.objectContaining({ type: 'voice_audio', bytes: 2 }),
      expect.objectContaining({ type: 'session_end', reason: 'completed' }),
    ]));
    expect(live.status()).toMatchObject({ state: 'idle', connected: false });
  });

  it('does not construct or connect the cloud session when local-only/offline filtering removes it', () => {
    const fixture = transportFixture();
    const createCloudSession = vi.fn(() => createGeminiLiveSession({ apiKey: 'test', transport: fixture.transport }));
    const policy = createInferenceModePolicy();
    const candidates = [{ id: 'gemini-live', locality: 'cloud', network: 'internet' }];

    expect(policy.filter(candidates, { mode: 'local-only', offline: false })).toEqual([]);
    expect(policy.filter(candidates, { mode: 'auto', offline: true })).toEqual([]);
    expect(createCloudSession).not.toHaveBeenCalled();
    expect(fixture.transport.connect).not.toHaveBeenCalled();
  });
});
