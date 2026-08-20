const DEFAULT_MAX_BYTES = 50 * 1024 * 1024;

function normalizeUrl(value) {
  let parsed;
  try {
    parsed = new URL(String(value ?? ''));
  } catch {
    throw new TypeError('document_download_url_invalid');
  }
  if (parsed.protocol !== 'https:') throw new Error('document_download_https_required');
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/gu, '');
  if (
    host === 'localhost'
    || host.endsWith('.localhost')
    || host === '::1'
    || host.startsWith('fe80:')
    || host.startsWith('fc')
    || host.startsWith('fd')
    || /^127\./u.test(host)
    || /^10\./u.test(host)
    || /^192\.168\./u.test(host)
    || /^169\.254\./u.test(host)
    || /^172\.(1[6-9]|2\d|3[01])\./u.test(host)
  ) {
    throw new Error('document_download_private_url_forbidden');
  }
  return parsed.href;
}

async function responseBytes(response, maxBytes) {
  if (response.status >= 300 && response.status < 400) throw new Error('document_download_redirect_unverified');
  if (!response.ok) throw new Error(`document_download_http_error:${response.status}`);
  const declaredLength = Number(response.headers?.get?.('content-length') ?? NaN);
  if (Number.isSafeInteger(declaredLength) && declaredLength > maxBytes) throw new Error('document_download_too_large');

  if (!response.body?.getReader) {
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength > maxBytes) throw new Error('document_download_too_large');
    return bytes;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = Buffer.from(value);
    total += chunk.byteLength;
    if (total > maxBytes) {
      await reader.cancel?.().catch?.(() => {});
      throw new Error('document_download_too_large');
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, total);
}

export function createHttpDocumentDownloadPort({ fetchImpl = fetch, maxBytes = DEFAULT_MAX_BYTES } = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('document_download_fetch_required');
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new TypeError('document_download_max_bytes_invalid');
  return Object.freeze({
    async download({ url } = {}) {
      const href = normalizeUrl(url);
      const response = await fetchImpl(href, { redirect: 'manual' });
      return Object.freeze({ bytes: await responseBytes(response, maxBytes) });
    },
  });
}
