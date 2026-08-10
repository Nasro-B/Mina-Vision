async function defaultLoadPdfJs() {
  return import('pdfjs-dist/legacy/build/pdf.mjs');
}

function throwIfAborted(signal) {
  if (typeof signal?.throwIfAborted === 'function') signal.throwIfAborted();
  else if (signal?.aborted) throw signal.reason ?? new Error('pdf_extraction_aborted');
}

function clearBytes(bytes) {
  try { bytes?.fill(0); } catch {}
}

function awaitAbortablePromise(value, signal, onAbort = null) {
  const promise = Promise.resolve(value);
  throwIfAborted(signal);
  if (typeof signal?.addEventListener !== 'function') return promise;

  return new Promise((resolve, reject) => {
    let settled = false;
    const complete = (callback, value) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', abort);
      callback(value);
    };
    const abort = () => {
      try { Promise.resolve(onAbort?.()).catch(() => {}); } catch {}
      complete(reject, signal.reason ?? new Error('pdf_extraction_aborted'));
    };
    signal.addEventListener('abort', abort, { once: true });
    promise.then(
      (value) => complete(resolve, value),
      (error) => complete(reject, error),
    );
    if (signal.aborted) abort();
  });
}

export function createPdfTextExtractor({ loadPdfJs = defaultLoadPdfJs } = {}) {
  return async function extractPdfText(bytes, { maxPages = 2_000, maxBytes = 25 * 1024 * 1024, signal } = {}) {
    const source = Buffer.from(bytes ?? []);
    let pdfData = null;
    let loadingTask = null;
    let document = null;
    let destroyPromise = null;
    const destroy = () => {
      if (!destroyPromise) {
        const target = document?.destroy ? document : loadingTask;
        try {
          destroyPromise = Promise.resolve(target?.destroy?.());
        } catch (error) {
          destroyPromise = Promise.reject(error);
        }
      }
      return destroyPromise;
    };
    try {
      if (source.length === 0) throw new Error('pdf_empty');
      if (source.length > maxBytes) throw new Error('file_too_large');
      throwIfAborted(signal);
      const pdfjs = await awaitAbortablePromise(loadPdfJs(), signal);
      throwIfAborted(signal);
      loadingTask = pdfjs.getDocument({
        data: (pdfData = new Uint8Array(source)),
        disableWorker: true,
        isEvalSupported: false,
        stopAtErrors: true,
        useSystemFonts: false,
      });
      document = await awaitAbortablePromise(loadingTask.promise, signal, destroy);
      if (!Number.isInteger(document.numPages) || document.numPages < 1) throw new Error('invalid_pdf_page_count');
      if (document.numPages > maxPages) throw new Error('pdf_page_limit');
      const pages = [];
      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
        throwIfAborted(signal);
        const page = await awaitAbortablePromise(document.getPage(pageNumber), signal, destroy);
        try {
          const content = await awaitAbortablePromise(
            page.getTextContent({ disableNormalization: false, includeMarkedContent: false }),
            signal,
            destroy,
          );
          const fragments = [];
          for (const item of content.items) {
            if (typeof item?.str !== 'string') continue;
            fragments.push(item.str);
            if (item.hasEOL) fragments.push('\n');
          }
          pages.push(fragments.join(' ').replace(/ +\n +/gu, '\n').replace(/[ \t]+/gu, ' ').trim());
        } finally {
          page.cleanup?.();
        }
      }
      return Object.freeze({
        text: pages.join('\n\n'),
        pages: document.numPages,
        pageTexts: Object.freeze([...pages]),
      });
    } finally {
      clearBytes(pdfData);
      clearBytes(source);
      try {
        await destroy();
      } catch (error) {
        if (!signal?.aborted) throw error;
      }
    }
  };
}
