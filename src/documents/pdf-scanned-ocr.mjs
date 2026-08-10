const DEFAULT_MAX_BYTES = 25 * 1024 * 1024;
const DEFAULT_MAX_PAGES = 10;
const DEFAULT_SCALE = 2;
const DEFAULT_MAX_PIXELS = 3_000_000;
const DEFAULT_MAX_PAGE_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_TOTAL_BYTES = 10 * 1024 * 1024;
const HARD_MAX_CANVAS_AREA_BYTES = DEFAULT_MAX_PIXELS * 4;

async function defaultLoadPdfJs() {
  return import('pdfjs-dist/legacy/build/pdf.mjs');
}

function positiveInteger(value, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  const candidate = value ?? fallback;
  if (!Number.isSafeInteger(candidate) || candidate < 1 || candidate > maximum) {
    throw new TypeError('document_pdf_ocr_options_invalid');
  }
  return candidate;
}

function validateScale(value) {
  const scale = value ?? DEFAULT_SCALE;
  if (!Number.isFinite(scale) || scale < 0.25 || scale > 4) throw new TypeError('document_pdf_ocr_options_invalid');
  return scale;
}

function throwIfAborted(signal) {
  if (typeof signal?.throwIfAborted === 'function') signal.throwIfAborted();
  else if (signal?.aborted) throw signal.reason ?? new Error('document_pdf_ocr_aborted');
}

function dimensionsFor(viewport, maxPixels) {
  const width = Math.ceil(Number(viewport?.width));
  const height = Math.ceil(Number(viewport?.height));
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1
    || width > maxPixels || height > maxPixels || width * height > maxPixels) {
    throw new Error('document_pdf_ocr_render_limit');
  }
  return { width, height };
}

export function createPdfPageRasterizer({ loadPdfJs = defaultLoadPdfJs } = {}) {
  if (typeof loadPdfJs !== 'function') throw new TypeError('document_pdf_ocr_loader_required');

  return async function rasterizePdfPages(bytes, {
    signal,
    maxBytes = DEFAULT_MAX_BYTES,
    maxPages = DEFAULT_MAX_PAGES,
    scale = DEFAULT_SCALE,
    maxPixels = DEFAULT_MAX_PIXELS,
    maxPageBytes = DEFAULT_MAX_PAGE_BYTES,
    maxTotalBytes = DEFAULT_MAX_TOTAL_BYTES,
  } = {}) {
    const boundedMaxBytes = positiveInteger(maxBytes, DEFAULT_MAX_BYTES, DEFAULT_MAX_BYTES);
    const boundedMaxPages = positiveInteger(maxPages, DEFAULT_MAX_PAGES, DEFAULT_MAX_PAGES);
    const boundedMaxPixels = positiveInteger(maxPixels, DEFAULT_MAX_PIXELS, DEFAULT_MAX_PIXELS);
    const boundedMaxPageBytes = positiveInteger(maxPageBytes, DEFAULT_MAX_PAGE_BYTES, DEFAULT_MAX_PAGE_BYTES);
    const boundedMaxTotalBytes = positiveInteger(maxTotalBytes, DEFAULT_MAX_TOTAL_BYTES, DEFAULT_MAX_TOTAL_BYTES);
    const rasterScale = validateScale(scale);
    let source = null;
    let loadingTask = null;
    const renderedPages = [];
    let completed = false;
    try {
      source = Buffer.from(bytes ?? []);
      if (source.length === 0) throw new Error('pdf_empty');
      if (source.length > boundedMaxBytes) throw new Error('file_too_large');
      throwIfAborted(signal);
      const pdfjs = await loadPdfJs();
      if (typeof pdfjs?.getDocument !== 'function') throw new Error('document_pdf_ocr_unavailable');
      loadingTask = pdfjs.getDocument({
        data: new Uint8Array(source),
        disableWorker: true,
        isEvalSupported: false,
        stopAtErrors: true,
        useSystemFonts: false,
        maxImageSize: DEFAULT_MAX_PIXELS,
        canvasMaxAreaInBytes: HARD_MAX_CANVAS_AREA_BYTES,
      });
      if (!loadingTask?.promise || typeof loadingTask.destroy !== 'function') {
        throw new Error('document_pdf_ocr_unavailable');
      }
      const document = await loadingTask.promise;
      if (!Number.isSafeInteger(document?.numPages) || document.numPages < 1) {
        throw new Error('document_pdf_ocr_result_invalid');
      }
      if (document.numPages > boundedMaxPages) throw new Error('document_pdf_ocr_page_limit');
      if (!document.canvasFactory?.create || !document.canvasFactory?.destroy || typeof document.getPage !== 'function') {
        throw new Error('document_pdf_ocr_unavailable');
      }

      let totalBytes = 0;
      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
        throwIfAborted(signal);
        const page = await document.getPage(pageNumber);
        let canvasAndContext = null;
        try {
          throwIfAborted(signal);
          if (typeof page?.getViewport !== 'function' || typeof page.render !== 'function') {
            throw new Error('document_pdf_ocr_unavailable');
          }
          const viewport = page.getViewport({ scale: rasterScale });
          const { width, height } = dimensionsFor(viewport, boundedMaxPixels);
          canvasAndContext = document.canvasFactory.create(width, height);
          if (!canvasAndContext?.canvas || !canvasAndContext.context || typeof canvasAndContext.canvas.toBuffer !== 'function') {
            throw new Error('document_pdf_ocr_unavailable');
          }
          throwIfAborted(signal);
          const renderTask = page.render({ canvasContext: canvasAndContext.context, viewport });
          if (!renderTask?.promise) throw new Error('document_pdf_ocr_unavailable');
          await renderTask.promise;
          throwIfAborted(signal);
          const png = Buffer.from(canvasAndContext.canvas.toBuffer('image/png'));
          if (png.length === 0 || png.length > boundedMaxPageBytes || totalBytes + png.length > boundedMaxTotalBytes) {
            png.fill(0);
            throw new Error('document_pdf_ocr_output_too_large');
          }
          totalBytes += png.length;
          renderedPages.push(Object.freeze({ page: pageNumber, bytes: png, mimeType: 'image/png' }));
        } finally {
          if (canvasAndContext) document.canvasFactory.destroy(canvasAndContext);
          page?.cleanup?.();
        }
      }

      completed = true;
      return Object.freeze({ pageCount: document.numPages, pages: Object.freeze(renderedPages) });
    } finally {
      if (!completed) renderedPages.forEach(({ bytes: rendered }) => rendered.fill(0));
      source?.fill(0);
      await loadingTask?.destroy?.();
    }
  };
}

function freezeOcrBlock({ text, page, box, confidence }) {
  return Object.freeze({
    text,
    sourceOffset: Object.freeze({ kind: 'ocr', page, box: Object.freeze([...box]) }),
    confidence,
  });
}

function validateRasterizedPdf(result) {
  if (!Number.isSafeInteger(result?.pageCount) || result.pageCount < 1 || !Array.isArray(result.pages)
    || result.pages.length !== result.pageCount) {
    throw new Error('document_pdf_ocr_result_invalid');
  }
  for (const [index, page] of result.pages.entries()) {
    if (!Number.isSafeInteger(page?.page) || page.page !== index + 1 || page.mimeType !== 'image/png'
      || (!Buffer.isBuffer(page.bytes) && !(page.bytes instanceof Uint8Array)) || page.bytes.length === 0) {
      throw new Error('document_pdf_ocr_result_invalid');
    }
  }
}

function readOcrBlocks(result, page) {
  if (!Array.isArray(result?.blocks)) throw new Error('document_ocr_result_invalid');
  return result.blocks.flatMap((block) => {
    const text = typeof block?.text === 'string' ? block.text.trim() : '';
    if (!text) return [];
    if (!Array.isArray(block.box) || block.box.length !== 4 || !block.box.every(Number.isFinite)
      || !Number.isFinite(block.confidence) || block.confidence < 0 || block.confidence > 1) {
      throw new Error('document_ocr_result_invalid');
    }
    return [freezeOcrBlock({ text, page, box: block.box, confidence: block.confidence })];
  });
}

export function createPdfScannedOcrFallback({ rasterizePdfPages, ocrProvider } = {}) {
  if (typeof rasterizePdfPages !== 'function') throw new TypeError('document_pdf_ocr_rasterizer_required');
  if (typeof ocrProvider?.recognize !== 'function') throw new TypeError('document_pdf_ocr_provider_required');

  return async function ocrScannedPdf(bytes, { signal } = {}) {
    throwIfAborted(signal);
    let rasterized = null;
    const blocks = [];
    try {
      rasterized = await rasterizePdfPages(bytes, { signal });
      validateRasterizedPdf(rasterized);
      for (const page of rasterized.pages) {
        throwIfAborted(signal);
        const result = await ocrProvider.recognize({ image: page.bytes, mimeType: page.mimeType });
        throwIfAborted(signal);
        blocks.push(...readOcrBlocks(result, page.page));
      }
      if (blocks.length === 0) throw new Error('document_pdf_ocr_text_empty');
      return Object.freeze({ pageCount: rasterized.pageCount, blocks: Object.freeze(blocks) });
    } finally {
      if (Array.isArray(rasterized?.pages)) {
        rasterized.pages.forEach((page) => {
          if (Buffer.isBuffer(page?.bytes) || page?.bytes instanceof Uint8Array) page.bytes.fill(0);
        });
      }
    }
  };
}
