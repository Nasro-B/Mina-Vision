import {
  redactSensitiveText,
  redactSensitiveValue,
  redactTargetedHtml,
  sanitizePublicUrl,
} from '../research/network-evidence.mjs';

const DEFAULT_LIMITS = Object.freeze({
  text: 30_000, dom: 60_000, scripts: 30_000, styles: 20_000, accessibility: 30_000,
});

function bounded(value, max) {
  const text = String(value ?? '');
  return Object.freeze({ content: text.slice(0, max), truncated: text.length > max });
}

function sanitizeDom(value) {
  return redactTargetedHtml(String(value)
    .replace(/<input\b(?=[^>]*\btype=["']hidden["'])[^>]*>/giu, '<input type="hidden" data-redacted="[REDACTED]">')
    .replace(/(<input\b(?=[^>]*\btype=["']password["'])[^>]*\bvalue=)(["'])[^"']*\2/giu, '$1"[REDACTED]"'));
}

export function createWebObserver({ page, limits = {} } = {}) {
  if (!page?.evaluate || !page?.locator || !page?.url) throw new TypeError('web_observer_page_required');
  const bounds = { ...DEFAULT_LIMITS, ...limits };

  async function collect() {
    const raw = await page.evaluate(() => {
      const isVisible = (node) => {
        const style = getComputedStyle(node);
        return style.display !== 'none' && style.visibility !== 'hidden' && node.getAttribute('aria-hidden') !== 'true';
      };
      const interactive = [...document.querySelectorAll('a,button,input,select,textarea,[role],[tabindex]')]
        .filter(isVisible)
        .filter((node) => !(node instanceof HTMLInputElement && node.type === 'hidden'))
        .slice(0, 500)
        .map((node) => ({
          tag: node.tagName.toLocaleLowerCase(),
          type: node.getAttribute('type') ?? '',
          value: node instanceof HTMLInputElement && node.type !== 'password' ? node.value : '',
          text: node.textContent?.trim().slice(0, 500) ?? '',
          ariaLabel: node.getAttribute('aria-label') ?? '',
          href: node instanceof HTMLAnchorElement ? node.href : '',
        }));
      return {
        title: document.title,
        visibleText: document.body?.innerText ?? '',
        interactive,
        dom: document.documentElement?.outerHTML ?? '',
        scripts: [...document.scripts].slice(0, 100).map((script) => ({
          src: script.src,
          inline: script.src ? '' : script.textContent ?? '',
        })),
        styles: [...document.querySelectorAll('style')].slice(0, 100).map((style) => style.textContent ?? ''),
      };
    });
    const accessibilityRaw = await page.locator('body').ariaSnapshot();
    const visibleText = bounded(redactSensitiveText(raw.visibleText), bounds.text);
    const dom = bounded(sanitizeDom(raw.dom), bounds.dom);
    const accessibility = bounded(redactSensitiveText(accessibilityRaw), bounds.accessibility);
    const scripts = bounded(JSON.stringify(raw.scripts.map((script) => ({
      src: script.src ? sanitizePublicUrl(new URL(script.src, page.url()).toString()) : '',
      inline: redactSensitiveText(script.inline),
    }))), bounds.scripts);
    const styles = bounded(raw.styles.join('\n'), bounds.styles);
    return Object.freeze({
      url: sanitizePublicUrl(page.url()),
      title: redactSensitiveText(raw.title).slice(0, 1_000),
      visibleText: visibleText.content,
      accessibility: accessibility.content,
      interactive: Object.freeze(redactSensitiveValue(raw.interactive.map((item) => ({
        ...item,
        value: ['password', 'hidden'].includes(String(item.type).toLocaleLowerCase('en-US')) ? '[REDACTED]' : item.value,
      })))),
      dom: dom.content,
      scripts: scripts.content,
      styles: styles.content,
      truncated: Object.freeze({
        visibleText: visibleText.truncated,
        accessibility: accessibility.truncated,
        dom: dom.truncated,
        scripts: scripts.truncated,
        styles: styles.truncated,
      }),
    });
  }

  async function inspect(operation, { sourceAuthorized = false } = {}) {
    const observation = await collect();
    if (operation === 'get_page_source' && sourceAuthorized !== true) throw new Error('web_source_authorization_required');
    const projections = {
      inspect_dom: ['dom', observation.dom],
      inspect_accessibility: ['accessibility', observation.accessibility],
      read_visible_text: ['visible_text', observation.visibleText],
      get_page_source: ['dom', JSON.stringify({ dom: observation.dom, scripts: observation.scripts, styles: observation.styles })],
    };
    const projection = projections[operation];
    if (!projection) throw new Error(`web_inspection_unknown:${operation}`);
    return Object.freeze({ kind: projection[0], content: projection[1], url: observation.url, truncated: observation.truncated });
  }

  return Object.freeze({ observe: collect, inspect });
}
