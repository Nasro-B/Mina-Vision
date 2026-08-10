import { describe, expect, it, vi } from 'vitest';
import {
  createImageOcrDocumentParser,
  createPdfTextDocumentParser,
} from '../src/documents/local-document-parsers.mjs';
import { createDocumentParserRegistry } from '../src/documents/document-parser-registry.mjs';

describe('parseurs document locaux', () => {
  it('préserve une preuve localisable pour chaque page PDF extraite', async () => {
    const parser = createPdfTextDocumentParser({
      pdfExtractor: async () => ({ pages: 2, pageTexts: ['Premier bloc', 'Second bloc'] }),
    });

    await expect(parser.parse({ bytes: Buffer.from('%PDF-fake') })).resolves.toEqual({
      pageCount: 2,
      blocks: [
        {
          text: 'Premier bloc',
          sourceOffset: { kind: 'pdf_text', page: 1, start: 0, end: 12 },
          confidence: 1,
        },
        {
          text: 'Second bloc',
          sourceOffset: { kind: 'pdf_text', page: 2, start: 0, end: 11 },
          confidence: 1,
        },
      ],
    });
  });

  it('préserve les zones et la confiance retournées par l’OCR image', async () => {
    const parser = createImageOcrDocumentParser({
      ocrProvider: {
        recognize: async () => ({
          blocks: [{ text: 'Montant TTC', box: [10, 20, 110, 42], confidence: 0.87 }],
        }),
      },
    });

    await expect(parser.parse({ bytes: Buffer.from('png'), mediaType: 'image/png' })).resolves.toEqual({
      pageCount: 1,
      blocks: [{
        text: 'Montant TTC',
        sourceOffset: { kind: 'ocr', page: 1, box: [10, 20, 110, 42] },
        confidence: 0.87,
      }],
    });
  });

  it('reçoit le type détecté par la quarantaine pour analyser une image via le registre', async () => {
    const parser = createImageOcrDocumentParser({
      ocrProvider: {
        recognize: async () => ({
          blocks: [{ text: 'Facture', box: [1, 2, 31, 14], confidence: 0.91 }],
        }),
      },
    });
    const registry = createDocumentParserRegistry({
      parsers: [parser],
      quarantineStore: {
        getRecord: async () => ({ documentId: 'image-1', detectedType: 'image/png', status: 'inspectable' }),
        readBytes: async () => Buffer.from('png'),
      },
      clock: () => 0,
    });

    await expect(registry.parse('image-1')).resolves.toMatchObject({
      documentId: 'image-1',
      mediaType: 'image/png',
      blocks: [{ sourceOffset: { kind: 'ocr', page: 1, box: [1, 2, 31, 14] } }],
    });
  });

  it('refuse un PDF sans texte au lieu de fabriquer une preuve', async () => {
    const parser = createPdfTextDocumentParser({
      pdfExtractor: async () => ({ pages: 1, pageTexts: ['   '] }),
    });

    await expect(parser.parse({ bytes: Buffer.from('%PDF-fake') })).rejects.toThrow('document_pdf_text_empty');
  });

  it('bascule un PDF sans couche texte vers le fallback OCR local', async () => {
    const ocrFallback = vi.fn(async () => ({
      pageCount: 1,
      blocks: [{
        text: 'Facture scannée',
        sourceOffset: { kind: 'ocr', page: 1, box: [1, 2, 30, 18] },
        confidence: 0.91,
      }],
    }));
    const parser = createPdfTextDocumentParser({
      pdfExtractor: async () => ({ pages: 1, pageTexts: ['   '] }),
      ocrFallback,
    });

    await expect(parser.parse({ bytes: Buffer.from('%PDF-fake') })).resolves.toEqual({
      pageCount: 1,
      blocks: [{
        text: 'Facture scannée',
        sourceOffset: { kind: 'ocr', page: 1, box: [1, 2, 30, 18] },
        confidence: 0.91,
      }],
    });
    expect(ocrFallback).toHaveBeenCalledOnce();
  });

  it('ne lance jamais le fallback OCR quand le PDF contient déjà du texte', async () => {
    const ocrFallback = vi.fn(async () => {
      throw new Error('ocr_should_not_run');
    });
    const parser = createPdfTextDocumentParser({
      pdfExtractor: async () => ({ pages: 1, pageTexts: ['Texte natif'] }),
      ocrFallback,
    });

    await expect(parser.parse({ bytes: Buffer.from('%PDF-fake') })).resolves.toMatchObject({
      blocks: [{ sourceOffset: { kind: 'pdf_text', page: 1 } }],
    });
    expect(ocrFallback).not.toHaveBeenCalled();
  });

  it('refuse une sortie OCR vide au lieu de la présenter comme une lecture', async () => {
    const parser = createImageOcrDocumentParser({
      ocrProvider: { recognize: async () => ({ blocks: [] }) },
    });

    await expect(parser.parse({ bytes: Buffer.from('png'), mediaType: 'image/png' })).rejects.toThrow('document_ocr_text_empty');
  });

  it('transmet le signal d’annulation au fournisseur OCR image', async () => {
    const recognize = vi.fn(async () => ({
      blocks: [{ text: 'Image', box: [1, 2, 3, 4], confidence: 0.9 }],
    }));
    const parser = createImageOcrDocumentParser({ ocrProvider: { recognize } });
    const controller = new AbortController();

    await parser.parse({ bytes: Buffer.from('png'), mediaType: 'image/png', signal: controller.signal });

    expect(recognize).toHaveBeenCalledWith(expect.objectContaining({ signal: controller.signal }));
  });
});
