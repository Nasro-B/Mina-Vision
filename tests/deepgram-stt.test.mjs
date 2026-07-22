import { describe, expect, it, vi } from 'vitest';
import { createDeepgramStt } from '../src/voice/deepgram-stt.mjs';

function createFakeSocket() {
  const listeners = new Map();
  return {
    readyState: 0,
    sent: [],
    addEventListener(type, handler) { listeners.set(type, handler); },
    send(data) { this.sent.push(data); },
    close: vi.fn(),
    open() { this.readyState = 1; listeners.get('open')?.(); },
    message(data) { listeners.get('message')?.({ data: JSON.stringify(data) }); },
    fail() { listeners.get('error')?.({ message: 'boom' }); },
    end() { this.readyState = 3; listeners.get('close')?.(); },
  };
}

describe('createDeepgramStt — oreilles de secours françaises', () => {
  it('connects with the key as a subprotocol — never in the URL — and streams French linear16', async () => {
    const socket = createFakeSocket();
    const wsFactory = vi.fn(() => socket);
    const stt = createDeepgramStt({ apiKey: 'dg-secret', wsFactory, setIntervalImpl: () => 0, clearIntervalImpl: () => {} });

    const starting = stt.start();
    socket.open();
    await expect(starting).resolves.toEqual({ listening: true });

    const [url, protocols] = wsFactory.mock.calls[0];
    expect(url).toContain('language=fr');
    expect(url).toContain('encoding=linear16');
    expect(url).toContain('sample_rate=16000');
    expect(url).not.toContain('dg-secret');
    expect(protocols).toEqual(['token', 'dg-secret']);
  });

  it('delivers only final non-empty transcripts', async () => {
    const socket = createFakeSocket();
    const transcripts = [];
    const stt = createDeepgramStt({
      apiKey: 'k', wsFactory: () => socket, onTranscript: (text) => transcripts.push(text),
      setIntervalImpl: () => 0, clearIntervalImpl: () => {},
    });
    const starting = stt.start();
    socket.open();
    await starting;

    socket.message({ type: 'Results', is_final: false, channel: { alternatives: [{ transcript: 'mets la mus' }] } });
    socket.message({ type: 'Results', is_final: true, channel: { alternatives: [{ transcript: ' mets la musique ' }] } });
    socket.message({ type: 'Results', is_final: true, channel: { alternatives: [{ transcript: '' }] } });
    socket.message({ type: 'Metadata' });

    expect(transcripts).toEqual(['mets la musique']);
  });

  it('sends audio only while open and reports the listening state honestly', async () => {
    const socket = createFakeSocket();
    const stt = createDeepgramStt({ apiKey: 'k', wsFactory: () => socket, setIntervalImpl: () => 0, clearIntervalImpl: () => {} });
    expect(stt.sendPcm16(Buffer.from([1, 2]))).toBe(false); // pas encore connecté
    const starting = stt.start();
    socket.open();
    await starting;
    expect(stt.sendPcm16(Buffer.from([1, 2]))).toBe(true);
    expect(stt.listening()).toBe(true);
    socket.end();
    expect(stt.listening()).toBe(false);
    expect(stt.sendPcm16(Buffer.from([3]))).toBe(false);
  });

  it('rejects a failed connection, refuses to start once closed, and closes the stream politely', async () => {
    const failing = createFakeSocket();
    const stt = createDeepgramStt({ apiKey: 'k', wsFactory: () => failing, setIntervalImpl: () => 0, clearIntervalImpl: () => {} });
    const starting = stt.start();
    failing.fail();
    await expect(starting).rejects.toThrow('deepgram_connect_failed');

    const socket = createFakeSocket();
    const polite = createDeepgramStt({ apiKey: 'k', wsFactory: () => socket, setIntervalImpl: () => 0, clearIntervalImpl: () => {} });
    const opening = polite.start();
    socket.open();
    await opening;
    polite.close();
    expect(socket.sent.some((frame) => String(frame).includes('CloseStream'))).toBe(true);
    await expect(polite.start()).rejects.toThrow('deepgram_session_closed');
    expect(() => createDeepgramStt({ apiKey: null })).toThrow('deepgram_unconfigured');
  });
});

describe('deepgram + self-model wiring contract', () => {
  it('falls back to Deepgram ears, feeds the SAME utterance route, and injects the derived self-brief', async () => {
    const { readFile } = await import('node:fs/promises');
    const main = await readFile('src/ui/main.mjs', 'utf8');
    const config = await readFile('src/config.mjs', 'utf8');

    // config: key exposed and redacted.
    expect(config).toContain('DEEPGRAM_API_KEY');
    expect(config).toMatch(/deepgramApiKey: config\.deepgramApiKey \? '\[configured\]'/u);

    // main: shared route for both ears, fallback on Gemini failure, mic feeds Deepgram when
    // Gemini is absent (chunks were previously dropped), everything closed on stop/quit.
    expect(main).toContain("from '../voice/deepgram-stt.mjs'");
    expect(main).toContain('buildUtteranceRoute');
    expect(main).toMatch(/startDeepgramFallback\(\)\.catch/u);
    expect(main).toMatch(/deepgramFallback\?\.sendPcm16\(buffer\)/u);
    expect(main).toMatch(/mina:voice-stop'[\s\S]{0,200}deepgramFallback\?\.close\(\)/u);

    // self-model: loaded at boot, fed ONLY through real events in send(), injected in the live
    // instruction next to the hardware state.
    expect(main).toContain("from '../core/self-model.mjs'");
    expect(main).toMatch(/selfModel\?\.observeEvent\(payload\)/u);
    expect(main).toMatch(/composeSelfBrief\(selfModel\?\.snapshot\(\)/u);
    expect(main).toMatch(/statePath: path\.join\(app\.getPath\('userData'\), 'self-model\.json'\)/u);
  });
});
