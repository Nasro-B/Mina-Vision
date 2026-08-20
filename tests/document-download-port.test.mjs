import { describe, expect, it, vi } from 'vitest';

describe('createHttpDocumentDownloadPort', () => {
  it('downloads HTTPS bytes without following unvalidated redirects', async () => {
    const { createHttpDocumentDownloadPort } = await import('../src/documents/http-download-port.mjs');
    const fetchImpl = vi.fn(async () => new Response(Buffer.from('pdf'), { status: 200 }));
    const port = createHttpDocumentDownloadPort({ fetchImpl, maxBytes: 10 });

    await expect(port.download({ url: 'https://example.test/facture.pdf' }))
      .resolves.toEqual({ bytes: Buffer.from('pdf') });
    expect(fetchImpl).toHaveBeenCalledWith('https://example.test/facture.pdf', { redirect: 'manual' });
  });

  it('rejects local/private URLs before fetch', async () => {
    const { createHttpDocumentDownloadPort } = await import('../src/documents/http-download-port.mjs');
    const fetchImpl = vi.fn();
    const port = createHttpDocumentDownloadPort({ fetchImpl });

    await expect(port.download({ url: 'http://example.test/facture.pdf' })).rejects.toThrow('document_download_https_required');
    await expect(port.download({ url: 'https://127.0.0.1/facture.pdf' })).rejects.toThrow('document_download_private_url_forbidden');
    await expect(port.download({ url: 'https://192.168.1.10/facture.pdf' })).rejects.toThrow('document_download_private_url_forbidden');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects redirects and oversized responses', async () => {
    const { createHttpDocumentDownloadPort } = await import('../src/documents/http-download-port.mjs');
    const redirected = createHttpDocumentDownloadPort({
      fetchImpl: vi.fn(async () => new Response(null, { status: 302, headers: { location: 'https://example.test/next.pdf' } })),
    });
    await expect(redirected.download({ url: 'https://example.test/facture.pdf' }))
      .rejects.toThrow('document_download_redirect_unverified');

    const tooLarge = createHttpDocumentDownloadPort({
      maxBytes: 2,
      fetchImpl: vi.fn(async () => new Response(Buffer.from('pdf'), { status: 200 })),
    });
    await expect(tooLarge.download({ url: 'https://example.test/facture.pdf' }))
      .rejects.toThrow('document_download_too_large');
  });
});
