import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { createLocalVoiceClient } from '../src/voice/local-voice-client.mjs';

function createFakeWorker() {
  const stdout = new PassThrough();
  const stdin = new PassThrough();
  const requests = [];
  let input = '';
  stdin.on('data', (chunk) => {
    input += chunk.toString('utf8');
    const lines = input.split('\n');
    input = lines.pop();
    for (const line of lines.filter(Boolean)) requests.push(JSON.parse(line));
  });
  return {
    stdout,
    stdin,
    requests,
    killed: false,
    kill() { this.killed = true; },
    on() {},
    reply(response) { stdout.write(`${JSON.stringify(response)}\n`); },
  };
}

describe('createLocalVoiceClient', () => {
  it('streams per-sentence PCM chunks through onAudioChunk, then resolves the request', async () => {
    const worker = createFakeWorker();
    const chunks = [];
    const client = createLocalVoiceClient({ spawnWorker: () => worker, onAudioChunk: (chunk) => chunks.push(chunk) });
    const speaking = client.speak('Bonjour. Je vous écoute.');
    await new Promise((resolve) => setImmediate(resolve));

    const { id } = worker.requests[0];
    const pcm = Buffer.from(new Int16Array([100, -100, 3000]).buffer).toString('base64');
    worker.reply({ id, event: 'chunk', index: 0, sampleRate: 24_000, pcmBase64: pcm });
    worker.reply({ id, event: 'chunk', index: 1, sampleRate: 24_000, pcmBase64: pcm });
    worker.reply({ id, ok: true, result: { chunks: 2 } });

    await expect(speaking).resolves.toEqual({ chunks: 2 });
    expect(chunks).toHaveLength(2);
    expect(chunks[0].audio).toBeInstanceOf(Uint8Array);
    expect(chunks[0].audio.byteLength).toBe(6); // 3 échantillons PCM16
    expect(chunks[0].sampleRate).toBe(24_000);
    client.close();
    expect(worker.killed).toBe(true);
  });

  it('ignores non-JSON stdout noise (model download progress) without failing the request', async () => {
    const worker = createFakeWorker();
    const client = createLocalVoiceClient({ spawnWorker: () => worker });
    const speaking = client.speak('Bonjour.');
    await new Promise((resolve) => setImmediate(resolve));

    worker.stdout.write('Downloading model: 42%\n');
    worker.reply({ id: worker.requests[0].id, ok: true, result: { chunks: 1 } });

    await expect(speaking).resolves.toEqual({ chunks: 1 });
    client.close();
  });

  it('rejects a timed-out synthesis and surfaces worker errors', async () => {
    const worker = createFakeWorker();
    const client = createLocalVoiceClient({ spawnWorker: () => worker, requestTimeoutMs: 5 });
    await expect(client.speak('Bonjour.')).rejects.toThrow('Délai voix locale dépassé');

    const second = createFakeWorker();
    const failing = createLocalVoiceClient({ spawnWorker: () => second });
    const speaking = failing.speak('Bonjour.');
    await new Promise((resolve) => setImmediate(resolve));
    second.reply({ id: second.requests[0].id, ok: false, error: 'local_voice_text_required' });
    await expect(speaking).rejects.toThrow('local_voice_text_required');
    failing.close();
  });

  it('spawns the worker lazily and refuses to speak once closed', async () => {
    const spawnWorker = vi.fn(() => createFakeWorker());
    const client = createLocalVoiceClient({ spawnWorker });
    expect(spawnWorker).not.toHaveBeenCalled(); // rien au repos — le worker ne naît qu'au premier speak
    client.close();
    await expect(client.speak('Bonjour.')).rejects.toThrow('Client voix locale fermé.');
    expect(spawnWorker).not.toHaveBeenCalled();
  });
});

describe('local voice wiring contract — natural fallback replaces robotic SAPI', () => {
  it('is wired end-to-end and SAPI only survives as the last resort', async () => {
    const { readFile } = await import('node:fs/promises');
    const main = await readFile('src/ui/main.mjs', 'utf8');
    const preload = await readFile('src/ui/preload.cjs', 'utf8');
    const renderer = await readFile('src/ui/renderer.js', 'utf8');

    // main: client imported, IPC registered, chunks re-emitted on the SAME audio channel, worker
    // closed with the app (zombie lesson).
    expect(main).toContain("from '../voice/local-voice-client.mjs'");
    expect(main).toContain("ipcMain.handle('mina:local-tts'");
    expect(main).toMatch(/onAudioChunk:.*send\('mina:voice-audio'/u);
    expect(main).toMatch(/will-quit[\s\S]{0,200}localVoiceInstance\?\.close\(\)/u);

    expect(preload).toContain("ipcRenderer.invoke('mina:local-tts'");

    // renderer: speak() goes local-first, SAPI is reachable ONLY from inside speak's rescue.
    expect(renderer).toContain('api.localTts(');
    expect(renderer).toMatch(/const speak = \(text\) => \{[\s\S]{0,300}speakSapi/u);
  });
});
