async function defaultLoadPdfJs() {
  return import('pdfjs-dist/legacy/build/pdf.mjs');
}

export function createPdfTextExtractor({ loadPdfJs = defaultLoadPdfJs } = {}) {
  return async function extractPdfText(bytes, { maxPages = 2_000, maxBytes = 25 * 1024 * 1024 } = {}) {
    const source = Buffer.from(bytes ?? []);
    if (source.length === 0) throw new Error('pdf_empty');
    if (source.length > maxBytes) throw new Error('file_too_large');
    const pdfjs = await loadPdfJs();
    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(source),
      disableWorker: true,
      isEvalSupported: false,
      stopAtErrors: true,
      useSystemFonts: false,
    });
    let document;
    try {
      document = await loadingTask.promise;
      if (!Number.isInteger(document.numPages) || document.numPages < 1) throw new Error('invalid_pdf_page_count');
      if (document.numPages > maxPages) throw new Error('pdf_page_limit');
      const pages = [];
      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
        const page = await document.getPage(pageNumber);
        const content = await page.getTextContent({ disableNormalization: false, includeMarkedContent: false });
        const fragments = [];
        for (const item of content.items) {
          if (typeof item?.str !== 'string') continue;
          fragments.push(item.str);
          if (item.hasEOL) fragments.push('\n');
        }
        pages.push(fragments.join(' ').replace(/ +\n +/gu, '\n').replace(/[ \t]+/gu, ' ').trim());
        page.cleanup?.();
      }
      return Object.freeze({
        text: pages.join('\n\n'),
        pages: document.numPages,
        pageTexts: Object.freeze([...pages]),
      });
    } finally {
      if (document?.destroy) await document.destroy();
      else if (loadingTask?.destroy) await loadingTask.destroy();
    }
  };
}
