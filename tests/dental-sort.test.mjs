import { describe, expect, it, vi } from 'vitest';
import { createGooglePhotosGrid, normalizePhotoId, runDentalSort } from '../src/missions/dental-sort.mjs';

function createGrid(batches) {
  let index = 0;
  return {
    goto: vi.fn(),
    listAssets: vi.fn(async () => batches[Math.min(index++, batches.length - 1)]),
    fetchImage: vi.fn(async (asset) => ({ data: Buffer.from(asset.id), mimeType: 'image/jpeg' })),
    select: vi.fn(),
    scrollForMore: vi.fn(),
    downloadSelected: vi.fn(),
  };
}

describe('normalizePhotoId', () => {
  it('removes only Google image sizing suffixes', () => {
    expect(normalizePhotoId('https://lh3.googleusercontent.com/photo=s320')).toBe('https://lh3.googleusercontent.com/photo');
    expect(normalizePhotoId('https://example.com/photo?x=1')).toBe('https://example.com/photo?x=1');
  });
});

describe('runDentalSort', () => {
  it('skips relevant section, deduplicates, and remains non-destructive in dry-run', async () => {
    const assets = [
      { id: 'skip', url: 'https://img/skip=s100', sectionIndex: '0' },
      { id: 'yes', url: 'https://img/yes=s100', sectionIndex: '1' },
      { id: 'no1', url: 'https://img/no1=s100', sectionIndex: '1' },
      { id: 'no2', url: 'https://img/no2=s100', sectionIndex: '1' },
      { id: 'yes-duplicate', url: 'https://img/yes=s200', sectionIndex: '1' },
    ];
    const grid = createGrid([assets, assets, assets, assets, assets, assets]);
    const vision = { classify: vi.fn(async ({ data }) => ({ match: data.toString() === 'yes' })) };
    const confirm = vi.fn();

    const report = await runDentalSort({ grid, vision, confirm, dryRun: true, maxItems: 10 });

    expect(report).toEqual({ analyzed: 3, selected: 1, rejected: 2, errors: 0, downloaded: false, stoppedReason: 'end_of_results' });
    expect(grid.select).not.toHaveBeenCalled();
    expect(grid.downloadSelected).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
  });

  it('requires explicit confirmation before download outside dry-run', async () => {
    const asset = { id: 'yes', url: 'https://img/yes=s100', sectionIndex: '1' };
    const grid = createGrid([[asset], [asset], [asset], [asset], [asset], [asset]]);
    const vision = { classify: vi.fn().mockResolvedValue({ match: true }) };
    const confirm = vi.fn().mockResolvedValue(true);

    const report = await runDentalSort({ grid, vision, confirm, dryRun: false, maxItems: 10 });

    expect(confirm).toHaveBeenCalledWith({ kind: 'download', count: 1 });
    expect(grid.select).toHaveBeenCalledTimes(1);
    expect(grid.downloadSelected).toHaveBeenCalledTimes(1);
    expect(report.downloaded).toBe(true);
  });

  it('counts provider errors without selecting the asset', async () => {
    const asset = { id: 'broken', url: 'https://img/broken=s100', sectionIndex: '1' };
    const grid = createGrid([[asset], [asset], [asset], [asset], [asset], [asset]]);
    const vision = { classify: vi.fn().mockRejectedValue(new Error('provider')) };

    const report = await runDentalSort({ grid, vision, dryRun: true, maxItems: 10 });

    expect(report.errors).toBe(1);
    expect(grid.select).not.toHaveBeenCalled();
  });
});

describe('createGooglePhotosGrid', () => {
  it('adapts a Google Photos thumbnail without downloading it', async () => {
    const checkbox = {
      getAttribute: vi.fn().mockResolvedValue('false'),
      click: vi.fn(),
    };
    const element = {
      getAttribute: vi.fn(async (name) => name === 'data-latest-bg' ? 'https://img/photo=s320' : null),
      $: vi.fn(async (selector) => selector === 'div[role="checkbox"]' ? checkbox : null),
      evaluate: vi.fn().mockResolvedValue('1'),
      screenshot: vi.fn().mockResolvedValue(Buffer.from('jpeg')),
      scrollIntoViewIfNeeded: vi.fn(),
      hover: vi.fn(),
    };
    const page = {
      $$: vi.fn().mockResolvedValue([element]),
      goto: vi.fn(),
      waitForTimeout: vi.fn(),
      evaluate: vi.fn(),
      keyboard: { press: vi.fn() },
    };
    const grid = createGooglePhotosGrid(page);

    await grid.goto('https://photos.google.com/search/example');
    const [asset] = await grid.listAssets();
    const image = await grid.fetchImage(asset);
    await grid.select(asset);
    await grid.scrollForMore();
    await grid.downloadSelected();

    expect(asset).toMatchObject({ url: 'https://img/photo=s320', sectionIndex: '1' });
    expect(image).toEqual({ data: Buffer.from('jpeg'), mimeType: 'image/jpeg' });
    expect(checkbox.click).toHaveBeenCalledOnce();
    expect(page.keyboard.press).toHaveBeenCalledWith('Shift+D');
  });
});
