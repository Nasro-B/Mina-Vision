import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { createTesseractOcrProvider } from '../src/providers/tesseract-ocr.mjs';

const TSV = [
  'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext',
  '5\t1\t1\t1\t1\t1\t10\t20\t60\t18\t96.5\tBonjour',
  '5\t1\t1\t1\t1\t2\t75\t20\t65\t18\t88.5\tMina',
].join('\n');

async function requireProcessRunner() {
  const api = await import('../src/providers/tesseract-ocr.mjs');
  expect(api.createTesseractProcessRunner).toBeTypeOf('function');
  return api.createTesseractProcessRunner;
}

function pendingChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = new EventEmitter();
  child.stdin.end = vi.fn();
  child.kill = vi.fn(() => child.emit('close', null));
  return child;
}

describe('Tesseract local OCR provider', () => {
  it('uses an installed local language and returns bounded OCR lines with source coordinates', async () => {
    const runner = vi.fn(async ({ args }) => {
      if (args[0] === '--list-langs') {
        return { code: 0, stdout: 'List of available languages in C:\\tessdata (2):\neng\nosd\n', stderr: '' };
      }
      return { code: 0, stdout: TSV, stderr: '' };
    });
    const provider = createTesseractOcrProvider({
      executablePath: 'C:\\Tesseract\\tesseract.exe',
      languagePreference: ['fra', 'eng'],
      runner,
      clock: (() => { let now = 0; return () => (now += 10); })(),
    });

    const controller = new AbortController();
    const result = await provider.recognize({ image: Buffer.from([1, 2, 3]), mimeType: 'image/png', signal: controller.signal });

    expect(result).toMatchObject({
      text: 'Bonjour Mina',
      blocks: [{ text: 'Bonjour Mina', box: [10, 20, 140, 38], confidence: 0.925 }],
      modelId: 'tesseract:eng',
      usage: { inputImages: 1 },
    });
    expect(runner.mock.calls.map(([call]) => call.args)).toEqual([
      ['--list-langs'],
      ['stdin', 'stdout', '-l', 'eng', 'tsv'],
    ]);
    expect(runner.mock.calls.every(([call]) => call.signal === controller.signal)).toBe(true);
  });

  it('refuses an image request before spawning a local process', async () => {
    const runner = vi.fn();
    const provider = createTesseractOcrProvider({ runner });

    await expect(provider.recognize({ image: Buffer.alloc(0), mimeType: 'image/png' }))
      .rejects.toThrow('tesseract_ocr_input_invalid');
    expect(runner).not.toHaveBeenCalled();
  });

  it('kills an already running local Tesseract process when cancelled', async () => {
    const createTesseractProcessRunner = await requireProcessRunner();
    const child = pendingChild();
    const spawnProcess = vi.fn(() => child);
    const runner = createTesseractProcessRunner({ spawnProcess });
    const controller = new AbortController();
    const pending = runner({
      executablePath: 'C:\\Tesseract\\tesseract.exe',
      args: ['stdin', 'stdout', '-l', 'eng', 'tsv'],
      input: Buffer.from([1, 2, 3]),
      timeoutMs: 1_000,
      signal: controller.signal,
    });

    controller.abort(new Error('tesseract_ocr_aborted'));

    await expect(pending).rejects.toThrow('tesseract_ocr_aborted');
    expect(spawnProcess).toHaveBeenCalledOnce();
    expect(child.kill).toHaveBeenCalledOnce();
  });

  it('efface la sortie OCR et retire ses listeners après annulation', async () => {
    const createTesseractProcessRunner = await requireProcessRunner();
    const child = pendingChild();
    const runner = createTesseractProcessRunner({ spawnProcess: () => child });
    const controller = new AbortController();
    const stdout = Buffer.from('texte OCR sensible');
    const stderr = Buffer.from('diagnostic OCR');
    const pending = runner({
      executablePath: 'C:\\Tesseract\\tesseract.exe',
      args: ['stdin', 'stdout', '-l', 'eng', 'tsv'],
      input: Buffer.from([1, 2, 3]),
      timeoutMs: 1_000,
      signal: controller.signal,
    });
    child.stdout.emit('data', stdout);
    child.stderr.emit('data', stderr);

    controller.abort(new Error('tesseract_ocr_aborted'));

    await expect(pending).rejects.toThrow('tesseract_ocr_aborted');
    expect(stdout.equals(Buffer.alloc(stdout.length))).toBe(true);
    expect(stderr.equals(Buffer.alloc(stderr.length))).toBe(true);
    expect(child.stdout.listenerCount('data')).toBe(0);
    expect(child.stderr.listenerCount('data')).toBe(0);
    expect(child.listenerCount('close')).toBe(0);
    expect(child.stdin.listenerCount('error')).toBe(0);
  });

  it('efface un chunk stdout qui dépasse la borne OCR', async () => {
    const createTesseractProcessRunner = await requireProcessRunner();
    const child = pendingChild();
    const runner = createTesseractProcessRunner({ spawnProcess: () => child });
    const overflow = Buffer.alloc(2 * 1024 * 1024 + 1, 7);
    const pending = runner({
      executablePath: 'C:\\Tesseract\\tesseract.exe',
      args: ['stdin', 'stdout', '-l', 'eng', 'tsv'],
      input: Buffer.from([1, 2, 3]),
      timeoutMs: 1_000,
    });

    child.stdout.emit('data', overflow);

    await expect(pending).rejects.toThrow('tesseract_output_too_large');
    expect(overflow.equals(Buffer.alloc(overflow.length))).toBe(true);
    expect(child.stdout.listenerCount('data')).toBe(0);
  });

  it('efface la partie stderr non conservée après troncature', async () => {
    const createTesseractProcessRunner = await requireProcessRunner();
    const child = pendingChild();
    const runner = createTesseractProcessRunner({ spawnProcess: () => child });
    const controller = new AbortController();
    const stderr = Buffer.alloc(32_769, 7);
    const pending = runner({
      executablePath: 'C:\\Tesseract\\tesseract.exe',
      args: ['stdin', 'stdout', '-l', 'eng', 'tsv'],
      input: Buffer.from([1, 2, 3]),
      timeoutMs: 1_000,
      signal: controller.signal,
    });
    child.stderr.emit('data', stderr);

    controller.abort(new Error('tesseract_ocr_aborted'));

    await expect(pending).rejects.toThrow('tesseract_ocr_aborted');
    expect(stderr.equals(Buffer.alloc(stderr.length))).toBe(true);
  });

  it('ne masque pas un résultat OCR quand le runner détache son entrée', async () => {
    const runner = vi.fn(async ({ args, input }) => {
      if (args[0] === '--list-langs') return { code: 0, stdout: 'eng\n', stderr: '' };
      structuredClone(input.buffer, { transfer: [input.buffer] });
      return { code: 0, stdout: TSV, stderr: '' };
    });
    const provider = createTesseractOcrProvider({ runner });

    await expect(provider.recognize({ image: new Uint8Array(10_000), mimeType: 'image/png' }))
      .resolves.toMatchObject({ text: 'Bonjour Mina', modelId: 'tesseract:eng' });
  });

  it('garde le handler stdin jusqu’à la fermeture après annulation', async () => {
    const createTesseractProcessRunner = await requireProcessRunner();
    const child = pendingChild();
    let stdinErrorWasUnhandled = false;
    const emit = child.stdin.emit.bind(child.stdin);
    child.stdin.emit = (event, ...args) => {
      try { return emit(event, ...args); } catch {
        if (event === 'error') stdinErrorWasUnhandled = true;
        return false;
      }
    };
    child.kill = vi.fn(() => {
      queueMicrotask(() => {
        child.stdin.emit('error', new Error('write EOF'));
        child.stdin.emit('close');
        child.emit('close', null);
      });
    });
    const runner = createTesseractProcessRunner({ spawnProcess: () => child });
    const controller = new AbortController();
    const pending = runner({
      executablePath: 'C:\\Tesseract\\tesseract.exe',
      args: ['stdin', 'stdout', '-l', 'eng', 'tsv'],
      input: Buffer.alloc(2 * 1024 * 1024),
      timeoutMs: 1_000,
      signal: controller.signal,
    });

    controller.abort(new Error('tesseract_ocr_aborted'));

    await expect(pending).rejects.toThrow('tesseract_ocr_aborted');
    await new Promise((resolve) => setImmediate(resolve));
    expect(stdinErrorWasUnhandled).toBe(false);
    expect(child.stdin.listenerCount('error')).toBe(0);
  });

  it('kills the process if writing the image to stdin fails synchronously', async () => {
    const createTesseractProcessRunner = await requireProcessRunner();
    const child = pendingChild();
    child.stdin.end.mockImplementation(() => { throw new Error('stdin_broken'); });
    const runner = createTesseractProcessRunner({ spawnProcess: () => child });

    await expect(runner({
      executablePath: 'C:\\Tesseract\\tesseract.exe',
      args: ['stdin', 'stdout', '-l', 'eng', 'tsv'],
      input: Buffer.from([1, 2, 3]),
      timeoutMs: 1_000,
    })).rejects.toThrow('tesseract_stdin_failed');
    expect(child.kill).toHaveBeenCalledOnce();
  });
});
