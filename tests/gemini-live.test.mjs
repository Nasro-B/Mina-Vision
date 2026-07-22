import { describe, expect, it, vi } from 'vitest';
import { createGeminiLiveSession, VOICE_READBACK_PREFIX } from '../src/providers/gemini-live.mjs';

function createTransport() {
  const session = {
    sendRealtimeInput: vi.fn(),
    sendClientContent: vi.fn(),
    close: vi.fn(),
  };
  let callbacks;
  return {
    session,
    transport: {
      connect: vi.fn(async (options) => {
        callbacks = options.callbacks;
        return session;
      }),
    },
    emit(message) { callbacks.onmessage({ message }); },
  };
}

describe('Gemini Live adapter', () => {
  it('streams PCM16 without logging or persisting it', async () => {
    const fake = createTransport();
    const live = createGeminiLiveSession({ apiKey: 'x', transport: fake.transport });
    await live.connect();

    await live.sendPcm16(Buffer.from([0, 1, 2, 3]));

    expect(fake.session.sendRealtimeInput).toHaveBeenCalledWith({
      audio: { data: 'AAECAw==', mimeType: 'audio/pcm;rate=16000' },
    });
  });

  it('emits transcripts and native audio chunks', async () => {
    const fake = createTransport();
    const onTranscript = vi.fn();
    const onAudio = vi.fn();
    const live = createGeminiLiveSession({ apiKey: 'x', transport: fake.transport, onTranscript, onAudio });
    await live.connect();

    fake.emit({ serverContent: { inputTranscription: { text: 'Salut Mina' } } });
    fake.emit({ serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: 'AQI=' } }] } } });

    expect(onTranscript).toHaveBeenCalledWith('Salut Mina');
    expect(onAudio).toHaveBeenCalledWith(Buffer.from([1, 2]), 'audio/pcm;rate=24000');
  });

  it('declares live tools in the session config and surfaces server tool calls', async () => {
    const fake = createTransport();
    const onToolCall = vi.fn();
    const tools = [{ functionDeclarations: [{ name: 'lancer_mission', description: 'Lance une mission', parameters: { type: 'OBJECT' } }] }];
    const live = createGeminiLiveSession({ apiKey: 'x', transport: fake.transport, tools, onToolCall });
    await live.connect();

    const [[options]] = fake.transport.connect.mock.calls;
    expect(options.config.tools).toBe(tools);

    fake.emit({ toolCall: { functionCalls: [{ id: 'fc1', name: 'lancer_mission', args: { objectif: 'mets du raï' } }] } });
    expect(onToolCall).toHaveBeenCalledWith({ id: 'fc1', name: 'lancer_mission', args: { objectif: 'mets du raï' } });
  });

  it('omits tools from the config when none are declared', async () => {
    const fake = createTransport();
    const live = createGeminiLiveSession({ apiKey: 'x', transport: fake.transport });
    await live.connect();

    const [[options]] = fake.transport.connect.mock.calls;
    expect(options.config.tools).toBeUndefined();
  });

  it('acknowledges a tool call back to the live session', async () => {
    const fake = createTransport();
    fake.session.sendToolResponse = vi.fn();
    const live = createGeminiLiveSession({ apiKey: 'x', transport: fake.transport });
    await live.connect();

    await live.sendToolResponse({ id: 'fc1', name: 'lancer_mission', response: { result: 'transmis' } });

    expect(fake.session.sendToolResponse).toHaveBeenCalledWith({
      functionResponses: [{ id: 'fc1', name: 'lancer_mission', response: { result: 'transmis' } }],
    });
  });

  it('signals a server-side barge-in (user spoke over Mina) so the client can cut its local audio queue', async () => {
    const fake = createTransport();
    const onInterrupted = vi.fn();
    const onEvent = vi.fn();
    const live = createGeminiLiveSession({ apiKey: 'x', transport: fake.transport, onInterrupted, onEvent });
    await live.connect();

    fake.emit({ serverContent: { interrupted: true } });

    expect(onInterrupted).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'voice_interrupted' }));
  });

  it('preserves fragment spacing so partial transcripts can be re-joined downstream', async () => {
    const fake = createTransport();
    const onTranscript = vi.fn();
    const live = createGeminiLiveSession({ apiKey: 'x', transport: fake.transport, onTranscript });
    await live.connect();

    fake.emit({ serverContent: { inputTranscription: { text: 'active' } } });
    fake.emit({ serverContent: { inputTranscription: { text: ' la caméra' } } });

    expect(onTranscript).toHaveBeenNthCalledWith(1, 'active');
    expect(onTranscript).toHaveBeenNthCalledWith(2, ' la caméra');
    expect(onTranscript.mock.calls.map(([t]) => t).join('')).toBe('active la caméra');
  });

  it('sends text turns and closes the live session', async () => {
    const fake = createTransport();
    const live = createGeminiLiveSession({ apiKey: 'x', transport: fake.transport });
    await live.connect();
    await live.sendText('Bonjour');
    live.close();

    expect(fake.session.sendClientContent).toHaveBeenCalledWith({
      turns: [{ role: 'user', parts: [{ text: 'Bonjour' }] }],
      turnComplete: true,
    });
    expect(fake.session.close).toHaveBeenCalledTimes(1);
  });

  it('fails closed before connection and on malformed PCM16', async () => {
    const live = createGeminiLiveSession({ apiKey: 'x', transport: createTransport().transport });
    await expect(live.sendText('Bonjour')).rejects.toThrow('non connectée');
    await live.connect();
    await expect(live.sendPcm16(Buffer.from([1]))).rejects.toThrow('PCM16 invalide');
  });

  it('defaults to a system instruction that overrides the model own "made by Google" self-knowledge with the creator persona', async () => {
    const fake = createTransport();
    const live = createGeminiLiveSession({ apiKey: 'x', transport: fake.transport });
    await live.connect();

    const [[options]] = fake.transport.connect.mock.calls;
    expect(options.config.systemInstruction).toContain('Tu es Mina');
    expect(options.config.systemInstruction).toContain('Nasro');
    expect(options.config.systemInstruction).toMatch(/jamais.*google|sans.*mentionner.*google/iu);
  });

  it('makes the model aware of its real mission capabilities (browser/desktop/phone) so it never claims to have no tools or to leave it to the owner', async () => {
    const fake = createTransport();
    const live = createGeminiLiveSession({ apiKey: 'x', transport: fake.transport });
    await live.connect();

    const [[options]] = fake.transport.connect.mock.calls;
    expect(options.config.systemInstruction).toMatch(/missions/iu);
    expect(options.config.systemInstruction).toMatch(/navigateur.*bureau.*t[eé]l[eé]phone|navigateur web.*windows.*android/iu);
    expect(options.config.systemInstruction).toMatch(/jamais.*(aucun outil|pas d.outils|c.est [aà] (lui|toi|vous) de le faire)/iu);
  });

  it('teaches the readback marker so deterministic replies are spoken verbatim by the natural Gemini voice', async () => {
    const fake = createTransport();
    const live = createGeminiLiveSession({ apiKey: 'x', transport: fake.transport });
    await live.connect();

    const [[options]] = fake.transport.connect.mock.calls;
    expect(VOICE_READBACK_PREFIX.startsWith('[DIS]')).toBe(true);
    expect(options.config.systemInstruction).toContain('[DIS]');
    expect(options.config.systemInstruction).toMatch(/mot pour mot/iu);
    expect(options.config.systemInstruction).toMatch(/sans (jamais )?prononcer.*\[DIS\]/iu);
  });

  it('tells the model a parallel deterministic system already handles camera/music/theme/browser commands, so it never claims it lacks access to them', async () => {
    const fake = createTransport();
    const live = createGeminiLiveSession({ apiKey: 'x', transport: fake.transport });
    await live.connect();

    const [[options]] = fake.transport.connect.mock.calls;
    expect(options.config.systemInstruction).toContain('caméra');
    expect(options.config.systemInstruction).toMatch(/jamais.*(pas accès|n.?as pas|incapable|ne peux pas)/iu);
  });

  it('tells the model it has no direct video feed and may describe vision only from the grounded camera tool result', async () => {
    const fake = createTransport();
    const live = createGeminiLiveSession({ apiKey: 'x', transport: fake.transport });
    await live.connect();

    const [[options]] = fake.transport.connect.mock.calls;
    expect(options.config.systemInstruction).toMatch(/pas.*flux vidéo direct|aucun flux vidéo direct/iu);
    expect(options.config.systemInstruction).toMatch(/outil.*voir_camera|voir_camera.*outil/iu);
    expect(options.config.systemInstruction).toMatch(/résultat.*outil|outil.*résultat/iu);
  });

  it('pins an explicit French female voice instead of inheriting the model default (which drifted masculine)', async () => {
    const fake = createTransport();
    const live = createGeminiLiveSession({ apiKey: 'x', transport: fake.transport });
    await live.connect();

    const [[options]] = fake.transport.connect.mock.calls;
    expect(options.config.speechConfig).toEqual({
      voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Aoede' } },
      languageCode: 'fr-FR',
    });
  });

  it('lets the voice be overridden', async () => {
    const fake = createTransport();
    const live = createGeminiLiveSession({ apiKey: 'x', transport: fake.transport, voiceName: 'Kore' });
    await live.connect();

    const [[options]] = fake.transport.connect.mock.calls;
    expect(options.config.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe('Kore');
  });

  it('gives Mina a warm, friendly, non-intrusive personality in the default instruction', async () => {
    const fake = createTransport();
    const live = createGeminiLiveSession({ apiKey: 'x', transport: fake.transport });
    await live.connect();

    const [[options]] = fake.transport.connect.mock.calls;
    expect(options.config.systemInstruction).toMatch(/chaleureuse/iu);
    expect(options.config.systemInstruction).toMatch(/jamais s[eè]che|jamais autoritaire|ni s[eè]che ni autoritaire/iu);
    expect(options.config.systemInstruction).toMatch(/pas adress[eé]|ne t.est pas adress[eé]/iu);
  });

  it('lets the system instruction be overridden entirely', async () => {
    const fake = createTransport();
    const live = createGeminiLiveSession({ apiKey: 'x', transport: fake.transport, systemInstruction: 'Instruction sur mesure.' });
    await live.connect();

    const [[options]] = fake.transport.connect.mock.calls;
    expect(options.config.systemInstruction).toBe('Instruction sur mesure.');
  });
});
