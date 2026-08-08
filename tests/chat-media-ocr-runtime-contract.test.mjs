import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('chat media OCR wiring contract', () => {
  it('wires the local Tesseract provider into received image perception', async () => {
    const source = await readFile(new URL('../src/ui/main.mjs', import.meta.url), 'utf8');

    expect(source).toContain("from '../providers/tesseract-ocr.mjs'");
    expect(source).toContain('const chatMediaOcr = createTesseractOcrProvider();');
    expect(source).toContain('ocrRecognize: ({ image, mimeType }) => chatMediaOcr.recognize({ image, mimeType }),');
  });
});
