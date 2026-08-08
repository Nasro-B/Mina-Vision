import { describe, expect, it, vi } from 'vitest';
import { createTesseractOcrProvider } from '../src/providers/tesseract-ocr.mjs';

const TSV = [
  'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext',
  '5\t1\t1\t1\t1\t1\t10\t20\t60\t18\t96.5\tBonjour',
  '5\t1\t1\t1\t1\t2\t75\t20\t65\t18\t88.5\tMina',
].join('\n');

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

    const result = await provider.recognize({ image: Buffer.from([1, 2, 3]), mimeType: 'image/png' });

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
  });

  it('refuses an image request before spawning a local process', async () => {
    const runner = vi.fn();
    const provider = createTesseractOcrProvider({ runner });

    await expect(provider.recognize({ image: Buffer.alloc(0), mimeType: 'image/png' }))
      .rejects.toThrow('tesseract_ocr_input_invalid');
    expect(runner).not.toHaveBeenCalled();
  });
});
