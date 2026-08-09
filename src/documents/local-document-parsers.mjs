const IMAGE_MEDIA_TYPES = new Set(['image/png', 'image/jpeg']);

function freezeBlock({ text, sourceOffset, confidence }) {
  return Object.freeze({
    text,
    sourceOffset: Object.freeze(sourceOffset),
    confidence,
  });
}

export function createPdfTextDocumentParser({ pdfExtractor } = {}) {
  if (typeof pdfExtractor !== 'function') throw new TypeError('document_pdf_parser_extractor_required');

  return Object.freeze({
    id: 'pdf-text-parser',
    version: '1',
    supports: (mediaType) => mediaType === 'application/pdf',
    async parse({ bytes, signal } = {}) {
      signal?.throwIfAborted();
      const extracted = await pdfExtractor(bytes, { signal });
      signal?.throwIfAborted();
      if (!Number.isInteger(extracted?.pages) || extracted.pages < 1
        || !Array.isArray(extracted.pageTexts) || extracted.pageTexts.length !== extracted.pages
        || !extracted.pageTexts.every((pageText) => typeof pageText === 'string')) {
        throw new Error('document_pdf_parser_result_invalid');
      }

      const blocks = extracted.pageTexts.flatMap((pageText, pageIndex) => {
        const text = pageText.trim();
        if (!text) return [];
        return [freezeBlock({
          text,
          sourceOffset: { kind: 'pdf_text', page: pageIndex + 1, start: 0, end: text.length },
          confidence: 1,
        })];
      });
      if (blocks.length === 0) throw new Error('document_pdf_text_empty');
      return Object.freeze({ pageCount: extracted.pages, blocks: Object.freeze(blocks) });
    },
  });
}

export function createImageOcrDocumentParser({ ocrProvider } = {}) {
  if (typeof ocrProvider?.recognize !== 'function') throw new TypeError('document_image_parser_ocr_required');

  return Object.freeze({
    id: 'tesseract-image-ocr-parser',
    version: '1',
    supports: (mediaType) => IMAGE_MEDIA_TYPES.has(mediaType),
    async parse({ bytes, mediaType, signal } = {}) {
      if (!IMAGE_MEDIA_TYPES.has(mediaType)) throw new Error('document_image_media_type_unsupported');
      signal?.throwIfAborted();
      const extracted = await ocrProvider.recognize({ image: bytes, mimeType: mediaType });
      signal?.throwIfAborted();
      if (!Array.isArray(extracted?.blocks)) throw new Error('document_ocr_result_invalid');

      const blocks = extracted.blocks.flatMap((block) => {
        const text = typeof block?.text === 'string' ? block.text.trim() : '';
        if (!text) return [];
        if (!Array.isArray(block.box) || block.box.length !== 4 || !block.box.every(Number.isFinite)
          || !Number.isFinite(block.confidence) || block.confidence < 0 || block.confidence > 1) {
          throw new Error('document_ocr_result_invalid');
        }
        return [freezeBlock({
          text,
          sourceOffset: { kind: 'ocr', page: 1, box: [...block.box] },
          confidence: block.confidence,
        })];
      });
      if (blocks.length === 0) throw new Error('document_ocr_text_empty');
      return Object.freeze({ pageCount: 1, blocks: Object.freeze(blocks) });
    },
  });
}
