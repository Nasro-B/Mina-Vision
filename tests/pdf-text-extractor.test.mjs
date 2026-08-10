import { describe, expect, it, vi } from 'vitest';
import { createPdfTextExtractor } from '../src/research/pdf-text-extractor.mjs';

function createPdf(text) {
  const escaped = text.replace(/([()\\])/gu, '\\$1');
  const stream = `BT /F1 18 Tf 72 720 Td (${escaped}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body);
}

function fakePdfJs(pageTexts) {
  return {
    getDocument: () => ({
      promise: Promise.resolve({
        numPages: pageTexts.length,
        getPage: async (pageNumber) => ({
          getTextContent: async () => ({
            items: [{ str: pageTexts[pageNumber - 1], hasEOL: false }],
          }),
          cleanup() {},
        }),
        async destroy() {},
      }),
      async destroy() {},
    }),
  };
}

describe('bounded PDF text extractor', () => {
  it('annule le chargement du module PDF.js avant toute lecture', async () => {
    const extract = createPdfTextExtractor({ loadPdfJs: () => new Promise(() => {}) });
    const controller = new AbortController();
    const pending = extract(Buffer.from('%PDF-fake'), { signal: controller.signal });

    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  }, 1_000);

  it('extracts text from a real one-page PDF with PDF.js', async () => {
    const extract = createPdfTextExtractor();
    await expect(extract(createPdf('Bonjour Mina Vision'), { maxPages: 10, maxBytes: 1_000_000 }))
      .resolves.toEqual({ text: 'Bonjour Mina Vision', pages: 1, pageTexts: ['Bonjour Mina Vision'] });
  });

  it('rejects page limits before reading page content', async () => {
    const getPage = vi.fn();
    const pdfjs = {
      getDocument: () => ({
        promise: Promise.resolve({ numPages: 11, getPage, cleanup: vi.fn(), destroy: vi.fn() }),
        destroy: vi.fn(),
      }),
    };
    const extract = createPdfTextExtractor({ loadPdfJs: async () => pdfjs });

    await expect(extract(Buffer.from('%PDF'), { maxPages: 10, maxBytes: 100 }))
      .rejects.toThrow('pdf_page_limit');
    expect(getPage).not.toHaveBeenCalled();
  });

  it('annule le chargement PDF texte avant la première page', async () => {
    let loadingCreated;
    const created = new Promise((resolve) => { loadingCreated = resolve; });
    const loadingTask = {
      promise: new Promise(() => {}),
      destroy: vi.fn(async () => {}),
    };
    const pdfjs = { getDocument: vi.fn(() => {
      loadingCreated();
      return loadingTask;
    }) };
    const extract = createPdfTextExtractor({ loadPdfJs: async () => pdfjs });
    const controller = new AbortController();
    const pending = extract(Buffer.from('%PDF-fake'), { signal: controller.signal });

    await created;
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(loadingTask.destroy).toHaveBeenCalledOnce();
  }, 1_000);

  it('annule la demande de page texte en cours', async () => {
    let pageRequested;
    const requested = new Promise((resolve) => { pageRequested = resolve; });
    const document = {
      numPages: 1,
      getPage: vi.fn(() => {
        pageRequested();
        return new Promise(() => {});
      }),
      destroy: vi.fn(async () => {}),
    };
    const loadingTask = { promise: Promise.resolve(document), destroy: vi.fn(async () => {}) };
    const pdfjs = { getDocument: vi.fn(() => loadingTask) };
    const extract = createPdfTextExtractor({ loadPdfJs: async () => pdfjs });
    const controller = new AbortController();
    const pending = extract(Buffer.from('%PDF-fake'), { signal: controller.signal });

    await requested;
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(document.destroy).toHaveBeenCalledOnce();
  }, 1_000);

  it('annule la lecture du texte d’une page en cours', async () => {
    let textRequested;
    const requested = new Promise((resolve) => { textRequested = resolve; });
    const page = {
      getTextContent: vi.fn(() => {
        textRequested();
        return new Promise(() => {});
      }),
      cleanup: vi.fn(),
    };
    const document = {
      numPages: 1,
      getPage: vi.fn(async () => page),
      destroy: vi.fn(async () => {}),
    };
    const loadingTask = { promise: Promise.resolve(document), destroy: vi.fn(async () => {}) };
    const pdfjs = { getDocument: vi.fn(() => loadingTask) };
    const extract = createPdfTextExtractor({ loadPdfJs: async () => pdfjs });
    const controller = new AbortController();
    const pending = extract(Buffer.from('%PDF-fake'), { signal: controller.signal });

    await requested;
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(page.cleanup).toHaveBeenCalledOnce();
    expect(document.destroy).toHaveBeenCalledOnce();
  }, 1_000);

  it('efface la copie de données confiée à PDF.js après extraction', async () => {
    let pdfData;
    const document = {
      numPages: 1,
      getPage: async () => ({
        getTextContent: async () => ({ items: [{ str: 'Mina', hasEOL: false }] }),
        cleanup() {},
      }),
      async destroy() {},
    };
    const pdfjs = {
      getDocument: vi.fn(({ data }) => {
        pdfData = data;
        return { promise: Promise.resolve(document), async destroy() {} };
      }),
    };
    const extract = createPdfTextExtractor({ loadPdfJs: async () => pdfjs });

    await extract(Buffer.from('%PDF-fake'));

    expect(Buffer.from(pdfData).equals(Buffer.alloc(pdfData.length))).toBe(true);
  });
});

describe('PDF text provenance', () => {
  it('retourne aussi le texte par page pour préserver la provenance aval', async () => {
    const extract = createPdfTextExtractor({ loadPdfJs: async () => fakePdfJs(['Première page', 'Deuxième page']) });

    await expect(extract(Buffer.from('%PDF-fake'))).resolves.toEqual({
      text: 'Première page\n\nDeuxième page',
      pages: 2,
      pageTexts: ['Première page', 'Deuxième page'],
    });
  });
});
