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
  it('annule le chargement du module PDF.js avant toute lecture', async () => {
    const createPdfPageRasterizer = await requireRasterizer();
    const rasterize = createPdfPageRasterizer({ loadPdfJs: () => new Promise(() => {}) });
    const controller = new AbortController();
    const pending = rasterize(Buffer.from('%PDF-fake'), { signal: controller.signal });

    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  }, 1_000);

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

  it('annule un rendu PDF déjà démarré', async () => {
    const fake = fakePdfJs();
    let rejectRender;
    let renderingStarted;
    const started = new Promise((resolve) => { renderingStarted = resolve; });
    const renderTask = {
      promise: new Promise((_resolve, reject) => { rejectRender = reject; }),
      cancel: vi.fn(() => rejectRender(new Error('render_cancelled'))),
    };
    fake.page.render.mockImplementation(() => {
      renderingStarted();
      return renderTask;
    });
    const createPdfPageRasterizer = await requireRasterizer();
    const rasterize = createPdfPageRasterizer({ loadPdfJs: async () => fake.pdfjs });
    const controller = new AbortController();
    const pending = rasterize(Buffer.from('%PDF-fake'), { signal: controller.signal });

    await started;
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(renderTask.cancel).toHaveBeenCalledOnce();
    expect(fake.page.cleanup).toHaveBeenCalledOnce();
    expect(fake.loadingTask.destroy).toHaveBeenCalledOnce();
  });

  it('annule le chargement PDF avant le premier rendu', async () => {
    let rejectLoading;
    let loadingCreated;
    const created = new Promise((resolve) => { loadingCreated = resolve; });
    const loadingTask = {
      promise: new Promise((_resolve, reject) => { rejectLoading = reject; }),
      destroy: vi.fn(async () => rejectLoading(new Error('loading_cancelled'))),
    };
    const pdfjs = { getDocument: vi.fn(() => {
      loadingCreated();
      return loadingTask;
    }) };
    const createPdfPageRasterizer = await requireRasterizer();
    const rasterize = createPdfPageRasterizer({ loadPdfJs: async () => pdfjs });
    const controller = new AbortController();
    const pending = rasterize(Buffer.from('%PDF-fake'), { signal: controller.signal });

    await created;
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(loadingTask.destroy).toHaveBeenCalledOnce();
  }, 1_000);

  it('annule la demande de page PDF avant le rendu', async () => {
    const fake = fakePdfJs();
    let pageRequested;
    const requested = new Promise((resolve) => { pageRequested = resolve; });
    fake.document.getPage.mockImplementation(() => {
      pageRequested();
      return new Promise(() => {});
    });
    const createPdfPageRasterizer = await requireRasterizer();
    const rasterize = createPdfPageRasterizer({ loadPdfJs: async () => fake.pdfjs });
    const controller = new AbortController();
    const pending = rasterize(Buffer.from('%PDF-fake'), { signal: controller.signal });

    await requested;
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(fake.loadingTask.destroy).toHaveBeenCalledOnce();
  }, 1_000);

  it('efface la copie de données confiée à PDF.js après le rendu', async () => {
    const fake = fakePdfJs();
    let pdfData;
    fake.pdfjs.getDocument.mockImplementation(({ data }) => {
      pdfData = data;
      return fake.loadingTask;
    });
    const createPdfPageRasterizer = await requireRasterizer();
    const rasterize = createPdfPageRasterizer({ loadPdfJs: async () => fake.pdfjs });

    await rasterize(Buffer.from('%PDF-fake'));

    expect(Buffer.from(pdfData).equals(Buffer.alloc(pdfData.length))).toBe(true);
  });
});

describe('fallback OCR local des PDF scannés', () => {
  it('attache les coordonnées OCR à la bonne page et efface les PNG après reconnaissance', async () => {
    const firstPng = Buffer.from('first-page');
    const secondPng = Buffer.from('second-page');
    const createPdfScannedOcrFallback = await requireOcrFallback();
    const recognize = vi.fn(async ({ image }) => (image === firstPng
      ? { blocks: [{ text: 'Facture', box: [1, 2, 30, 18], confidence: 0.91 }] }
      : { blocks: [{ text: 'Total', box: [3, 4, 48, 22], confidence: 0.82 }] }));
    const fallback = createPdfScannedOcrFallback({
      rasterizePdfPages: async () => ({
        pageCount: 2,
        pages: [
          { page: 1, bytes: firstPng, mimeType: 'image/png' },
          { page: 2, bytes: secondPng, mimeType: 'image/png' },
        ],
      }),
      ocrProvider: { recognize },
    });

    const controller = new AbortController();
    await expect(fallback(Buffer.from('%PDF-fake'), { signal: controller.signal })).resolves.toEqual({
      pageCount: 2,
      blocks: [
        { text: 'Facture', sourceOffset: { kind: 'ocr', page: 1, box: [1, 2, 30, 18] }, confidence: 0.91 },
        { text: 'Total', sourceOffset: { kind: 'ocr', page: 2, box: [3, 4, 48, 22] }, confidence: 0.82 },
      ],
    });
    expect(firstPng.equals(Buffer.alloc(firstPng.length))).toBe(true);
    expect(secondPng.equals(Buffer.alloc(secondPng.length))).toBe(true);
    expect(recognize).toHaveBeenCalledWith(expect.objectContaining({ signal: controller.signal }));
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

  it('ne masque pas une extraction OCR dont le buffer a été détaché', async () => {
    const png = new Uint8Array([1, 2, 3]);
    const createPdfScannedOcrFallback = await requireOcrFallback();
    const fallback = createPdfScannedOcrFallback({
      rasterizePdfPages: async () => ({
        pageCount: 1,
        pages: [{ page: 1, bytes: png, mimeType: 'image/png' }],
      }),
      ocrProvider: {
        recognize: async ({ image }) => {
          structuredClone(image.buffer, { transfer: [image.buffer] });
          return { blocks: [{ text: 'Mina', box: [1, 2, 3, 4], confidence: 0.9 }] };
        },
      },
    });

    await expect(fallback(Buffer.from('%PDF-fake'))).resolves.toMatchObject({
      pageCount: 1,
      blocks: [{ text: 'Mina' }],
    });
    expect(png.byteLength).toBe(0);
  });
});
