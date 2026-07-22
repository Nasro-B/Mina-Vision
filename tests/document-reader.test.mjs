import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDocumentReader } from '../src/files/document-reader.mjs';

let root;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'mina-document-reader-'));
});

afterEach(async () => rm(root, { recursive: true, force: true }));

describe('bounded document reader', () => {
  it('loads the Office parser lazily with macros, OCR and attachments disabled', async () => {
    const path = join(root, 'manual.docx');
    await writeFile(path, Buffer.from('PK synthetic fixture'));
    const to = vi.fn(async () => ({ value: 'Titre\ntoken="secret-value"' }));
    const parseOffice = vi.fn(async () => ({ to }));
    const loadOfficeParser = vi.fn(async () => ({ OfficeParser: { parseOffice } }));
    const reader = createDocumentReader({ loadOfficeParser, chunkChars: 10 });

    const result = await reader.read({ path, maxBytes: 1_024 });

    expect(loadOfficeParser).toHaveBeenCalledTimes(1);
    expect(parseOffice).toHaveBeenCalledWith(expect.any(Buffer), expect.objectContaining({
      fileType: 'docx',
      ocr: false,
      extractAttachments: false,
      ignoreInternalLinks: true,
      includeRawContent: false,
      serializeRawContent: false,
    }));
    expect(to).toHaveBeenCalledWith('text');
    expect(result.text).toBe('Titre\ntoken="[REDACTED]"');
    expect(result.chunks.length).toBeGreaterThan(1);
  });

  it('keeps PDF extraction on the isolated PDF.js adapter', async () => {
    const path = join(root, 'manual.pdf');
    await writeFile(path, Buffer.from('%PDF synthetic fixture'));
    const pdfExtractor = vi.fn(async () => ({ text: 'Page une', pages: 1 }));
    const loadOfficeParser = vi.fn();
    const reader = createDocumentReader({ pdfExtractor, loadOfficeParser });

    await expect(reader.read({ path, maxBytes: 1_024 })).resolves.toMatchObject({
      format: 'pdf',
      pages: 1,
      method: 'pdf_text_adapter',
    });
    expect(loadOfficeParser).not.toHaveBeenCalled();
  });
});
