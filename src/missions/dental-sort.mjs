const GOOGLE_SIZE_SUFFIX = /=(?:s|w|h)\d+(?:-[a-z0-9-]+)?$/i;

export function normalizePhotoId(url) {
  if (typeof url !== 'string') return '';
  return url.replace(GOOGLE_SIZE_SUFFIX, '');
}

async function thumbnailUrl(element) {
  const dataBackground = await element.getAttribute('data-latest-bg');
  if (dataBackground?.startsWith('http')) return dataBackground;

  const style = await element.getAttribute('style');
  const backgroundMatch = style?.match(/url\(['"]?([^'")]+)['"]?\)/i);
  if (backgroundMatch?.[1]?.startsWith('http')) return backgroundMatch[1];

  const image = await element.$('img[src*="googleusercontent"]');
  return image?.getAttribute('src') ?? null;
}

export function createGooglePhotosGrid(page) {
  if (!page) throw new TypeError('A Playwright page is required');

  return Object.freeze({
    goto: async (searchUrl) => {
      const url = new URL(searchUrl);
      if (url.protocol !== 'https:' || url.hostname !== 'photos.google.com') {
        throw new Error('URL Google Photos interdite.');
      }
      await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await page.waitForTimeout(1_000);
    },
    listAssets: async () => {
      let elements = await page.$$('[data-latest-bg]');
      if (!elements.length) elements = await page.$$('div[style*="background-image"]');

      const assets = [];
      for (const element of elements) {
        const url = await thumbnailUrl(element);
        if (!url) continue;
        const sectionIndex = await element.evaluate((node) => {
          let current = node;
          for (let depth = 0; current && depth < 12; depth += 1) {
            const index = current.getAttribute?.('data-section-index');
            if (index !== null && index !== undefined) return index;
            current = current.parentElement;
          }
          return null;
        }).catch(() => null);
        assets.push({ id: normalizePhotoId(url), url, sectionIndex, element });
      }
      return assets;
    },
    fetchImage: async (asset) => ({
      data: await asset.element.screenshot({ type: 'jpeg', quality: 90 }),
      mimeType: 'image/jpeg',
    }),
    select: async (asset) => {
      const element = asset.element;
      await element.scrollIntoViewIfNeeded();
      await element.hover();
      let checkbox = await element.$('div[role="checkbox"]');
      if (!checkbox) {
        checkbox = await element.$('xpath=ancestor::*[.//div[@role="checkbox"]][1]//div[@role="checkbox"]');
      }
      if (!checkbox) throw new Error('Case de sélection Google Photos introuvable.');
      if (await checkbox.getAttribute('aria-checked') !== 'true') await checkbox.click();
    },
    scrollForMore: async () => {
      await page.evaluate(() => {
        const candidates = [document.scrollingElement, ...document.querySelectorAll('*')].filter(Boolean);
        const target = candidates.reduce((best, element) => {
          const scrollable = element.scrollHeight > element.clientHeight;
          return scrollable && element.scrollHeight > (best?.scrollHeight ?? 0) ? element : best;
        }, null);
        (target ?? window).scrollBy(0, 1_000);
      });
      await page.keyboard.press('PageDown');
      await page.waitForTimeout(1_500);
    },
    downloadSelected: async () => {
      await page.keyboard.press('Shift+D');
      await page.waitForTimeout(1_000);
    },
  });
}

export async function runDentalSort({
  grid,
  vision,
  confirm = async () => false,
  dryRun = true,
  maxItems = 100,
  searchUrl,
  onProgress = () => {},
  maxEmptyRounds = 5,
}) {
  if (!grid || typeof grid.listAssets !== 'function') {
    throw new TypeError('A Google Photos grid adapter is required');
  }
  if (!vision || typeof vision.classify !== 'function') {
    throw new TypeError('A dental vision provider is required');
  }

  if (searchUrl && typeof grid.goto === 'function') {
    await grid.goto(searchUrl);
  }

  const report = {
    analyzed: 0,
    selected: 0,
    rejected: 0,
    errors: 0,
    downloaded: false,
    stoppedReason: 'end_of_results',
  };
  const seen = new Set();
  let emptyRounds = 0;

  while (emptyRounds < maxEmptyRounds && report.analyzed < maxItems) {
    const assets = await grid.listAssets();
    let newCandidates = 0;

    for (const asset of assets ?? []) {
      const id = normalizePhotoId(asset?.url) || String(asset?.id ?? '');
      if (!id || seen.has(id)) continue;
      seen.add(id);

      if (String(asset.sectionIndex) === '0') continue;
      if (report.analyzed >= maxItems) break;

      newCandidates += 1;
      report.analyzed += 1;

      try {
        const image = await grid.fetchImage(asset);
        const result = await vision.classify(image);

        if (result?.match === true) {
          report.selected += 1;
          if (!dryRun && typeof grid.select === 'function') {
            await grid.select(asset);
          }
        } else {
          report.rejected += 1;
        }
      } catch {
        report.errors += 1;
      }

      await onProgress({ ...report, current: asset });
    }

    emptyRounds = newCandidates === 0 ? emptyRounds + 1 : 0;
    if (report.analyzed < maxItems && emptyRounds < maxEmptyRounds && typeof grid.scrollForMore === 'function') {
      await grid.scrollForMore();
    }
  }

  if (report.analyzed >= maxItems) {
    report.stoppedReason = 'max_items';
  }

  if (!dryRun && report.selected > 0) {
    const approved = await confirm({ kind: 'download', count: report.selected });
    if (approved && typeof grid.downloadSelected === 'function') {
      await grid.downloadSelected();
      report.downloaded = true;
    }
  }

  return report;
}
