import { createHash } from 'node:crypto';
import {
  captureNetworkResponse,
  redactSensitiveText,
  redactSensitiveValue,
  redactTargetedHtml,
  sanitizePublicUrl,
} from './network-evidence.mjs';

function evidence({ locator, extract, capturedAt, suffix }) {
  const digest = createHash('sha256').update(extract).digest('hex');
  return Object.freeze({
    sourceId: `web-${suffix}-${digest.slice(0, 20)}`,
    locator,
    capturedAt,
    contentDigest: `sha256:${digest}`,
    freshnessClass: 'current',
    extract: extract.slice(0, 4_000),
    method: 'structured_extraction',
  });
}

function robotsAllows(body, pathname) {
  const disallowed = String(body).split(/\r?\n/u)
    .map((line) => line.replace(/#.*$/u, '').trim())
    .filter((line) => /^disallow\s*:/iu.test(line))
    .map((line) => line.replace(/^disallow\s*:/iu, '').trim())
    .filter(Boolean);
  return !disallowed.some((rule) => pathname.startsWith(rule));
}

async function extractFrame(frame) {
  return frame.evaluate(() => ({
    title: document.title,
    visibleText: document.body?.innerText ?? '',
  }));
}

export function createWebReader({
  page,
  fetchImpl = fetch,
  clock = Date.now,
  maxNetworkBodyBytes = 1024 * 1024,
} = {}) {
  if (!page?.goto || !page?.evaluate) throw new TypeError('playwright_page_required');

  async function checkIndexing(url, { operation, indexingAuthorized, authenticated }) {
    if (operation !== 'index') return;
    if (authenticated) throw new Error('authenticated_page_indexing_forbidden');
    if (indexingAuthorized !== true) throw new Error('web_indexing_authorization_required');
    const robotsUrl = new URL('/robots.txt', url);
    const response = await fetchImpl(robotsUrl, { headers: { 'user-agent': 'MinaVisionBot/1.0' } });
    if (response.ok && !robotsAllows(await response.text(), new URL(url).pathname)) {
      throw new Error('robots_disallow_indexing');
    }
  }

  async function read({
    url,
    operation = 'read',
    indexingAuthorized = false,
    authenticated = false,
    selectors = [],
    styleRequests = [],
  } = {}) {
    const requested = new URL(url);
    if (!['http:', 'https:'].includes(requested.protocol)) throw new Error('unsupported_web_protocol');
    await checkIndexing(requested, { operation, indexingAuthorized, authenticated });

    const pendingResponses = [];
    const onResponse = (response) => {
      pendingResponses.push(captureNetworkResponse(response, { clock, maxBodyBytes: maxNetworkBodyBytes })
        .catch(() => null));
    };
    page.on('response', onResponse);
    try {
      await page.goto(requested.toString(), { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
      await page.waitForTimeout(50);
      const finalUrl = sanitizePublicUrl(page.url());
      const finalOrigin = new URL(page.url()).origin;
      const capturedAt = new Date(Number(typeof clock === 'function' ? clock() : clock.now())).toISOString();
      const structured = await page.evaluate(({ requestedSelectors, requestedStyles }) => {
        const metadata = Object.fromEntries([...document.querySelectorAll('meta[name],meta[property]')]
          .map((node) => [node.getAttribute('name') ?? node.getAttribute('property'), node.getAttribute('content') ?? '']));
        const jsonLd = [...document.querySelectorAll('script[type="application/ld+json"]')].flatMap((node) => {
          try { return [JSON.parse(node.textContent ?? '')]; } catch { return []; }
        });
        const targetedHtml = requestedSelectors.map((selector) => ({
          selector,
          html: document.querySelector(selector)?.outerHTML ?? '',
        }));
        const computedStyles = requestedStyles.map(({ selector, properties }) => {
          const node = document.querySelector(selector);
          const style = node ? getComputedStyle(node) : null;
          return {
            selector,
            values: Object.fromEntries(properties.map((property) => [property, style?.getPropertyValue(property) ?? ''])),
          };
        });
        return {
          title: document.title,
          visibleText: document.body?.innerText ?? '',
          links: [...document.querySelectorAll('a[href]')].map((node) => ({ text: node.textContent?.trim() ?? '', url: node.href })),
          metadata,
          jsonLd,
          targetedHtml,
          computedStyles,
          scripts: [...document.scripts].map((node) => ({ src: node.src, type: node.type, inline: node.src ? '' : node.textContent ?? '' })),
        };
      }, { requestedSelectors: selectors, requestedStyles: styleRequests });

      const accessibility = await page.locator('body').ariaSnapshot();
      const frames = [];
      for (const frame of page.frames()) {
        if (frame === page.mainFrame() || !frame.url() || new URL(frame.url()).origin !== finalOrigin) continue;
        const value = await extractFrame(frame);
        frames.push({
          url: sanitizePublicUrl(frame.url()),
          title: value.title,
          visibleText: redactSensitiveText(value.visibleText),
          accessibility: await frame.locator('body').ariaSnapshot(),
        });
      }
      const network = (await Promise.all(pendingResponses)).filter(Boolean);
      const visibleText = redactSensitiveText(structured.visibleText);
      const targetedHtml = structured.targetedHtml.map((item) => ({ ...item, html: redactTargetedHtml(item.html) }));
      const scripts = structured.scripts.map((script) => ({
        src: script.src ? sanitizePublicUrl(script.src) : '',
        type: script.type,
        inline: redactSensitiveText(script.inline).slice(0, 20_000),
      }));
      const evidenceList = [evidence({ locator: `${finalUrl}#body`, extract: visibleText, capturedAt, suffix: 'body' })];
      frames.forEach((frame, index) => evidenceList.push(evidence({
        locator: frame.url,
        extract: frame.visibleText,
        capturedAt,
        suffix: `frame-${index}`,
      })));
      targetedHtml.filter(({ html }) => html).forEach(({ selector, html }, index) => evidenceList.push(evidence({
        locator: `${finalUrl}#${encodeURIComponent(selector)}`,
        extract: html,
        capturedAt,
        suffix: `selector-${index}`,
      })));
      network.forEach((item) => evidenceList.push(item.evidence));

      return Object.freeze({
        finalUrl,
        title: structured.title,
        visibleText,
        accessibility: redactSensitiveText(accessibility),
        frames,
        links: structured.links.map((link) => ({ text: redactSensitiveText(link.text), url: sanitizePublicUrl(link.url) })),
        metadata: redactSensitiveValue(structured.metadata),
        jsonLd: redactSensitiveValue(structured.jsonLd),
        targetedHtml,
        computedStyles: structured.computedStyles,
        scripts,
        network: network.map(({ evidence: _evidence, ...item }) => item),
        evidence: evidenceList,
        rawStored: false,
        authenticated,
      });
    } finally {
      page.off('response', onResponse);
    }
  }

  return Object.freeze({ read });
}
