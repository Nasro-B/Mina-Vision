import { describe, expect, it, vi } from 'vitest';

async function loadScannedPdfOcr() {
  try {
    return await import('../src/documents/pdf-scanned-ocr.mjs');
  } catch (error) {
    return { error };
  }
}

function fakePdfJs({ pages = 1, viewport = { width: 288, height: 288 }, png = Buffer.from('png-page-1') } = {}) {
  const canvas = {
    toBuffer: vi.fn(() => Buffer.from(png)),
  };
  const canvasAndContext = { canvas, context: { canvas } };
  const page = {
    getViewport: vi.fn(() => viewport),
    render: vi.fn(() => ({ promise: Promise.resolve() })),
    cleanup: vi.fn(),
  };
  const document = {
    numPages: pages,
    canvasFactory: {
      create: vi.fn(() => canvasAndContext),
      destroy: vi.fn(),
    },
    getPage: vi.fn(async () => page),
  };
  const loadingTask = {
    promise: Promise.resolve(document),
    destroy: vi.fn(async () => {}),
  };
  return {
    pdfjs: { getDocument: vi.fn(() => loadingTask) },
    document,
    page,
    loadingTask,
  };
}

async function requireRasterizer() {
  const api = await loadScannedPdfOcr();
  expect(api.error).toBeUndefined();
  expect(api.createPdfPageRasterizer).toBeTypeOf('function');
  return api.createPdfPageRasterizer;
}

async function requireOcrFallback() {
  const api = await loadScannedPdfOcr();
  expect(api.error).toBeUndefined();
  expect(api.createPdfScannedOcrFallback).toBeTypeOf('function');
  return api.createPdfScannedOcrFallback;
}

describe('rendu local des PDF scannés', () => {
  it('rend les pages PDF dans des PNG bornés et conserve leur numéro', async () => {
    const fake = fakePdfJs();
    const createPdfPageRasterizer = await requireRasterizer();
    const rasterize = createPdfPageRasterizer({ loadPdfJs: async () => fake.pdfjs });

    await expect(rasterize(Buffer.from('%PDF-fake'))).resolves.toEqual({
      pageCount: 1,
      pages: [{ page: 1, bytes: Buffer.from('png-page-1'), mimeType: 'image/png' }],
    });
    expect(fake.document.canvasFactory.create).toHaveBeenCalledWith(288, 288);
    expect(fake.page.render).toHaveBeenCalledWith({
      canvasContext: fake.document.canvasFactory.create.mock.results[0].value.context,
      viewport: { width: 288, height: 288 },
    });
    expect(fake.page.cleanup).toHaveBeenCalledOnce();
    expect(fake.document.canvasFactory.destroy).toHaveBeenCalledOnce();
    expect(fake.loadingTask.destroy).toHaveBeenCalledOnce();
    expect(fake.pdfjs.getDocument).toHaveBeenCalledWith(expect.objectContaining({
      maxImageSize: 3_000_000,
      canvasMaxAreaInBytes: 12_000_000,
    }));
  });

  it('refuse de relever les bornes de décodage PDF par appelant', async () => {
    const fake = fakePdfJs();
    const createPdfPageRasterizer = await requireRasterizer();
    const rasterize = createPdfPageRasterizer({ loadPdfJs: async () => fake.pdfjs });

    await expect(rasterize(Buffer.from('%PDF-fake'), { maxPixels: 3_000_001 }))
      .rejects.toThrow('document_pdf_ocr_options_invalid');
    expect(fake.pdfjs.getDocument).not.toHaveBeenCalled();
  });

  it('refuse le nombre de pages OCR avant de rendre une page', async () => {
    const fake = fakePdfJs({ pages: 11 });
    const createPdfPageRasterizer = await requireRasterizer();
    const rasterize = createPdfPageRasterizer({ loadPdfJs: async () => fake.pdfjs });

    await expect(rasterize(Buffer.from('%PDF-fake'))).rejects.toThrow('document_pdf_ocr_page_limit');
    expect(fake.document.getPage).not.toHaveBeenCalled();
    expect(fake.loadingTask.destroy).toHaveBeenCalledOnce();
  });

  it('refuse une page dont le rendu dépasserait la borne de pixels avant le canvas', async () => {
    const fake = fakePdfJs({ viewport: { width: 2_001, height: 1_500 } });
    const createPdfPageRasterizer = await requireRasterizer();
    const rasterize = createPdfPageRasterizer({ loadPdfJs: async () => fake.pdfjs });

    await expect(rasterize(Buffer.from('%PDF-fake'))).rejects.toThrow('document_pdf_ocr_render_limit');
    expect(fake.document.canvasFactory.create).not.toHaveBeenCalled();
    expect(fake.page.cleanup).toHaveBeenCalledOnce();
    expect(fake.loadingTask.destroy).toHaveBeenCalledOnce();
  });

  it('détruit canvas et tâche PDF si le PNG dépasse la borne', async () => {
    const fake = fakePdfJs({ png: Buffer.alloc(9, 7) });
    const createPdfPageRasterizer = await requireRasterizer();
    const rasterize = createPdfPageRasterizer({ loadPdfJs: async () => fake.pdfjs });

    await expect(rasterize(Buffer.from('%PDF-fake'), { maxPageBytes: 8 })).rejects.toThrow('document_pdf_ocr_output_too_large');
    expect(fake.page.cleanup).toHaveBeenCalledOnce();
    expect(fake.document.canvasFactory.destroy).toHaveBeenCalledOnce();
    expect(fake.loadingTask.destroy).toHaveBeenCalledOnce();
  });
});

describe('fallback OCR local des PDF scannés', () => {
  it('attache les coordonnées OCR à la bonne page et efface les PNG après reconnaissance', async () => {
    const firstPng = Buffer.from('first-page');
    const secondPng = Buffer.from('second-page');
    const createPdfScannedOcrFallback = await requireOcrFallback();
    const fallback = createPdfScannedOcrFallback({
      rasterizePdfPages: async () => ({
        pageCount: 2,
        pages: [
          { page: 1, bytes: firstPng, mimeType: 'image/png' },
          { page: 2, bytes: secondPng, mimeType: 'image/png' },
        ],
      }),
      ocrProvider: {
        recognize: async ({ image }) => (image === firstPng
          ? { blocks: [{ text: 'Facture', box: [1, 2, 30, 18], confidence: 0.91 }] }
          : { blocks: [{ text: 'Total', box: [3, 4, 48, 22], confidence: 0.82 }] }),
      },
    });

    await expect(fallback(Buffer.from('%PDF-fake'))).resolves.toEqual({
      pageCount: 2,
      blocks: [
        { text: 'Facture', sourceOffset: { kind: 'ocr', page: 1, box: [1, 2, 30, 18] }, confidence: 0.91 },
        { text: 'Total', sourceOffset: { kind: 'ocr', page: 2, box: [3, 4, 48, 22] }, confidence: 0.82 },
      ],
    });
    expect(firstPng.equals(Buffer.alloc(firstPng.length))).toBe(true);
    expect(secondPng.equals(Buffer.alloc(secondPng.length))).toBe(true);
  });

  it('refuse un PDF scanné dont l’OCR local ne fournit aucun bloc', async () => {
    const png = Buffer.from('empty-page');
    const createPdfScannedOcrFallback = await requireOcrFallback();
    const fallback = createPdfScannedOcrFallback({
      rasterizePdfPages: async () => ({ pageCount: 1, pages: [{ page: 1, bytes: png, mimeType: 'image/png' }] }),
      ocrProvider: { recognize: async () => ({ blocks: [] }) },
    });

    await expect(fallback(Buffer.from('%PDF-fake'))).rejects.toThrow('document_pdf_ocr_text_empty');
    expect(png.equals(Buffer.alloc(png.length))).toBe(true);
  });

  it('efface les PNG même si le résultat de rasterisation est invalide', async () => {
    const png = Buffer.from('invalid-page');
    const createPdfScannedOcrFallback = await requireOcrFallback();
    const fallback = createPdfScannedOcrFallback({
      rasterizePdfPages: async () => ({
        pageCount: 1,
        pages: [{ page: 1, bytes: png, mimeType: 'image/jpeg' }],
      }),
      ocrProvider: { recognize: async () => ({ blocks: [] }) },
    });

    await expect(fallback(Buffer.from('%PDF-fake'))).rejects.toThrow('document_pdf_ocr_result_invalid');
    expect(png.equals(Buffer.alloc(png.length))).toBe(true);
  });
});
