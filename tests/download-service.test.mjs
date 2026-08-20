import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createDownloadService } from '../src/documents/download-service.mjs';

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function fakeFilesystem(preload = new Map()) {
  return {
    files: preload,
    exists: vi.fn(async (path) => preload.has(path)),
    readFile: vi.fn(async (path) => preload.get(path)),
    writeFile: vi.fn(async (path, bytes, options) => {
      if (options?.flag === 'wx' && preload.has(path)) throw new Error('EEXIST');
      preload.set(path, bytes);
    }),
  };
}

const BYTES = Buffer.from('contenu du fichier');
const DIGEST = sha256(BYTES);

function buildWorld(overrides = {}) {
  const filesystem = fakeFilesystem();
  const browserDownloadPort = { download: vi.fn(async () => ({ bytes: BYTES })) };
  const service = createDownloadService({ browserDownloadPort, filesystem, clock: () => 1_700_000_000_000, ...overrides });
  return { service, filesystem, browserDownloadPort };
}

describe('createDownloadService: constructor guards', () => {
  it('requires a browserDownloadPort', () => {
    expect(() => createDownloadService({ filesystem: fakeFilesystem(), clock: () => 0 })).toThrow('download_service_browser_download_port_required');
  });
});

describe('createDownloadService.download: fixes final URL/digest/destination', () => {
  it('downloads, verifies the digest, and atomically writes to the destination', async () => {
    const { service, filesystem } = buildWorld();
    const result = await service.download({ finalUrl: 'https://example.test/facture.pdf', digest: DIGEST, destination: 'downloads/facture.pdf' });
    expect(result).toMatchObject({ destination: 'downloads/facture.pdf', digest: DIGEST, status: 'completed' });
    expect(filesystem.writeFile).toHaveBeenCalledWith('downloads/facture.pdf', BYTES, expect.objectContaining({ flag: 'wx' }));
  });

  it('rejects when the downloaded content digest does not match the proposal digest', async () => {
    const browserDownloadPort = { download: vi.fn(async () => ({ bytes: Buffer.from('tampered content') })) };
    const { service } = buildWorld({ browserDownloadPort });
    await expect(service.download({ finalUrl: 'https://example.test/x.pdf', digest: DIGEST, destination: 'downloads/x.pdf' }))
      .rejects.toThrow('download_digest_mismatch');
  });
});

describe('createDownloadService.download: optional local confirmation', () => {
  it('refuses the download when the digest confirmation is denied or mismatched', async () => {
    const denied = buildWorld({ confirmationService: { confirm: vi.fn(async () => ({ approved: false, digest: DIGEST })) } });
    await expect(denied.service.download({ finalUrl: 'https://example.test/facture.pdf', digest: DIGEST, destination: 'downloads/facture.pdf' }))
      .rejects.toThrow('document_download_confirmation_refused');
    expect(denied.browserDownloadPort.download).not.toHaveBeenCalled();

    const mismatch = buildWorld({ confirmationService: { confirm: vi.fn(async () => ({ approved: true, digest: `sha256:${'b'.repeat(64)}` })) } });
    await expect(mismatch.service.download({ finalUrl: 'https://example.test/facture.pdf', digest: DIGEST, destination: 'downloads/facture.pdf' }))
      .rejects.toThrow('document_download_confirmation_refused');
    expect(mismatch.browserDownloadPort.download).not.toHaveBeenCalled();
  });
});

describe('createDownloadService.download: idempotent, never overwrites', () => {
  it('a second download for the same already-completed destination/digest is idempotent and never re-downloads', async () => {
    const { service, browserDownloadPort } = buildWorld();
    const proposal = { finalUrl: 'https://example.test/facture.pdf', digest: DIGEST, destination: 'downloads/facture.pdf' };
    const first = await service.download(proposal);
    const second = await service.download(proposal);
    expect(browserDownloadPort.download).toHaveBeenCalledTimes(1);
    expect(second.status).toBe('already_present');
    expect(first.digest).toBe(second.digest);
  });

  it('rejects when the destination already holds different content (never silently overwrites)', async () => {
    const filesystem = fakeFilesystem(new Map([['downloads/facture.pdf', Buffer.from('autre contenu')]]));
    const { service } = buildWorld({ filesystem });
    await expect(service.download({ finalUrl: 'https://example.test/facture.pdf', digest: DIGEST, destination: 'downloads/facture.pdf' }))
      .rejects.toThrow('download_destination_already_exists');
  });

  it('requires finalUrl/digest/destination to all be present', async () => {
    const { service } = buildWorld();
    await expect(service.download({ digest: DIGEST, destination: 'x' })).rejects.toThrow('download_proposal_url_required');
  });
});
