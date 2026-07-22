import path from 'node:path';
import { createWebObserver } from '../perception/web-observer.mjs';

const DEFAULT_VIEWPORT = Object.freeze({ width: 1_440, height: 900 });

const defaultLaunchContext = async (profileDir) => {
  const { chromium } = await import('playwright');
  return chromium.launchPersistentContext(profileDir, {
    channel: 'chrome',
    headless: false,
    viewport: DEFAULT_VIEWPORT,
  });
};

const playwrightKey = (key) => {
  const aliases = { CTRL: 'Control', CONTROL: 'Control', ALT: 'Alt', SHIFT: 'Shift', ENTER: 'Enter', ESC: 'Escape' };
  return aliases[String(key).toUpperCase()] || key;
};

export async function createBrowserExecutor({
  launchContext = defaultLaunchContext,
  profileDir = path.resolve('profiles/mina-chrome'),
  webObserverFactory,
} = {}) {
  const context = await launchContext(profileDir);
  let page = context.pages().at(-1) || await context.newPage();
  let closed = false;
  const createObserver = (currentPage) => (webObserverFactory
    ? webObserverFactory(currentPage)
    : currentPage.evaluate && currentPage.locator ? createWebObserver({ page: currentPage }) : null);
  let webObserver = createObserver(page);
  context.on?.('page', (nextPage) => {
    page = nextPage;
    webObserver = createObserver(nextPage);
  });
  context.on?.('close', () => { closed = true; });
  let cursorPosition = { x: 24, y: 24 };
  // The cursor overlay is cosmetic and redrawn on every action: any evaluate that loses its page
  // (closed target, navigation tearing down the execution context, detached frame) means « no
  // overlay right now », never an error worth a cursor_error entry in the technical journal.
  const isBenignCursorError = (error) => /target page, context or browser has been closed|target closed|browser has been closed|execution context was destroyed|frame was detached|navigation/iu
    .test(String(error?.message ?? error));
  const evaluateCursor = async (callback, payload) => {
    if (page.isClosed?.()) return false;
    try {
      if (payload === undefined) await page.evaluate(callback);
      else await page.evaluate(callback, payload);
      return true;
    } catch (error) {
      if (page.isClosed?.() || isBenignCursorError(error)) return false;
      throw error;
    }
  };

  const previewAction = async (action = {}, { safety = {} } = {}) => {
    if (Number.isFinite(action.x) && Number.isFinite(action.y)) {
      cursorPosition = { x: action.x, y: action.y };
    }
    const payload = {
      ...cursorPosition,
      name: String(action.name ?? 'action').slice(0, 40),
      decision: ['allow', 'confirm', 'block'].includes(safety.decision) ? safety.decision : 'allow',
    };
    const visible = await evaluateCursor((value) => {
      document.querySelector('#mina-virtual-cursor')?.remove();
      const root = document.createElement('div');
      root.id = 'mina-virtual-cursor';
      root.setAttribute('aria-hidden', 'true');
      root.style.cssText = `position:fixed;left:${value.x}px;top:${value.y}px;z-index:2147483647;pointer-events:none;transform:translate(-8px,-8px);font:600 11px/1.2 system-ui,sans-serif;color:#fff;filter:drop-shadow(0 2px 4px rgba(0,0,0,.45))`;
      const color = value.decision === 'confirm' ? '#f59e0b' : value.decision === 'block' ? '#ef4444' : '#7c3aed';
      const dot = document.createElement('span');
      dot.style.cssText = `display:block;width:18px;height:18px;border:3px solid white;border-radius:50%;background:${color};box-shadow:0 0 0 2px ${color}`;
      const label = document.createElement('span');
      label.style.cssText = `display:block;margin:5px 0 0 9px;padding:3px 6px;border-radius:6px;background:${color};white-space:nowrap`;
      label.textContent = `Mina · ${value.name}`;
      root.append(dot, label);
      document.documentElement.append(root);
    }, payload);
    return { visible };
  };

  const hideCursor = async () => {
    await evaluateCursor(() => document.querySelector('#mina-virtual-cursor')?.remove());
    return { visible: false };
  };

  const handlers = {
    click: (action) => page.mouse.click(action.x, action.y, { button: 'left', clickCount: 1 }),
    double_click: (action) => page.mouse.click(action.x, action.y, { button: 'left', clickCount: 2 }),
    triple_click: (action) => page.mouse.click(action.x, action.y, { button: 'left', clickCount: 3 }),
    middle_click: (action) => page.mouse.click(action.x, action.y, { button: 'middle', clickCount: 1 }),
    right_click: (action) => page.mouse.click(action.x, action.y, { button: 'right', clickCount: 1 }),
    move: (action) => page.mouse.move(action.x, action.y),
    mouse_down: async (action) => { await page.mouse.move(action.x, action.y); await page.mouse.down({ button: 'left' }); },
    mouse_up: async (action) => { await page.mouse.move(action.x, action.y); await page.mouse.up({ button: 'left' }); },
    drag: async (action) => {
      await page.mouse.move(action.x, action.y);
      await page.mouse.down({ button: 'left' });
      try {
        await page.mouse.move(action.endX, action.endY, { steps: 10 });
      } finally {
        await page.mouse.up({ button: 'left' });
      }
    },
    scroll: async (action) => {
      if (Number.isFinite(action.x) && Number.isFinite(action.y)) await page.mouse.move(action.x, action.y);
      await page.mouse.wheel(action.scrollX || 0, action.scrollY || 0);
    },
    type: async (action) => {
      const hasEditableTargetFocused = () => page.evaluate(() => {
        const element = document.activeElement;
        if (!element) return false;
        if (element instanceof HTMLTextAreaElement) return !element.disabled && !element.readOnly;
        if (element instanceof HTMLInputElement) {
          const nonTextTypes = new Set(['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit']);
          return !element.disabled && !element.readOnly && !nonTextTypes.has(element.type);
        }
        return element.isContentEditable === true;
      });
      let editableTargetFocused = await hasEditableTargetFocused();
      if (!editableTargetFocused && Number.isFinite(action.x) && Number.isFinite(action.y)) {
        await page.mouse.click(action.x, action.y, { button: 'left', clickCount: 1 });
        editableTargetFocused = await hasEditableTargetFocused();
      }
      if (!editableTargetFocused && Number.isFinite(action.x) && Number.isFinite(action.y)) {
        // The model's click often lands a few pixels OUTSIDE the field (magnifier icon, padding,
        // label): focus stays on body and the mission loops on « :body » errors. Focus the nearest
        // VISIBLE editable element around the click point — tight radius: this corrects aim, it
        // never guesses a field elsewhere on the page.
        await page.evaluate(({ x, y }) => {
          const nonTextTypes = new Set(['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit']);
          const nearest = [...document.querySelectorAll('input, textarea, [contenteditable="true"], [contenteditable=""]')]
            .filter((element) => {
              if (element.disabled || element.readOnly) return false;
              if (element instanceof HTMLInputElement && nonTextTypes.has(element.type)) return false;
              const rect = element.getBoundingClientRect();
              return rect.width > 0 && rect.height > 0;
            })
            .map((element) => {
              const rect = element.getBoundingClientRect();
              const nearestX = Math.min(Math.max(x, rect.left), rect.right);
              const nearestY = Math.min(Math.max(y, rect.top), rect.bottom);
              return { element, distance: Math.hypot(nearestX - x, nearestY - y) };
            })
            .filter((entry) => entry.distance <= 150)
            .sort((first, second) => first.distance - second.distance)[0];
          nearest?.element.focus();
        }, { x: action.x, y: action.y });
        editableTargetFocused = await hasEditableTargetFocused();
      }
      if (!editableTargetFocused) {
        // Name what DOES hold focus: a bare error made the model retry the same blind type action;
        // « :body » or « :button » tells it the click missed and which correction to make.
        const focusedTag = await page.evaluate(() => document.activeElement?.tagName?.toLowerCase() ?? 'none').catch(() => 'unknown');
        throw new Error(`browser_text_target_not_focused:${focusedTag}`);
      }
      if (action.replaceText === true) await page.keyboard.press('Control+A');
      await page.keyboard.insertText(action.text);
      if (action.pressEnter) await page.keyboard.press('Enter');
    },
    key: (action) => page.keyboard.press(action.keys.map(playwrightKey).join('+')),
    key_down: async (action) => {
      for (const key of action.keys) await page.keyboard.down(playwrightKey(key));
    },
    key_up: async (action) => {
      for (const key of [...action.keys].reverse()) await page.keyboard.up(playwrightKey(key));
    },
    navigate: (action) => page.goto(action.url, { waitUntil: 'domcontentloaded', timeout: 60_000 }),
    go_back: () => page.goBack({ waitUntil: 'domcontentloaded', timeout: 30_000 }),
    go_forward: () => page.goForward({ waitUntil: 'domcontentloaded', timeout: 30_000 }),
    wait: (action) => page.waitForTimeout(Math.min(Math.max(action.milliseconds || 1_000, 0), 5_000)),
    observe: async () => {},
    inspect_dom: (action) => webObserver?.inspect('inspect_dom', { sourceAuthorized: action.sourceAuthorized === true }),
    inspect_accessibility: (action) => webObserver?.inspect('inspect_accessibility', { sourceAuthorized: action.sourceAuthorized === true }),
    read_visible_text: (action) => webObserver?.inspect('read_visible_text', { sourceAuthorized: action.sourceAuthorized === true }),
    get_page_source: (action) => webObserver?.inspect('get_page_source', { sourceAuthorized: action.sourceAuthorized === true }),
  };

  // Actions that can start a navigation: without a short settle, the post-action screenshot often
  // captures a half-loaded page — the model then burns a whole extra turn just waiting. Resolves
  // instantly when no navigation is in flight; a timeout must never fail the action itself.
  const NAVIGATION_TRIGGERS = new Set(['click', 'double_click', 'go_back', 'go_forward', 'navigate']);
  const settleAfterNavigation = async (action) => {
    const triggers = NAVIGATION_TRIGGERS.has(action.name)
      || (action.name === 'type' && action.pressEnter === true)
      || (action.name === 'key' && (action.keys ?? []).some((key) => String(key).toUpperCase() === 'ENTER'));
    if (!triggers || typeof page.waitForLoadState !== 'function') return;
    await page.waitForLoadState('domcontentloaded', { timeout: 2_500 }).catch(() => {});
  };

  return Object.freeze({
    // Mission observations stay light on purpose: screenshot + url only. The structured web payload
    // (full outerHTML + text + 500 elements, ~100KB+) is never sent to the computer-use model, so
    // computing it twice per turn was pure per-turn latency — it stays available on demand through
    // the inspect_* actions below.
    observe: async () => {
      // 10 s bornés + animations gelées : sur une page vidéo (YouTube), le screenshot par défaut
      // attend une stabilité qui n'arrive jamais — 30 s de blocage observés en réel, puis la
      // mission mourait. Un navigateur fermé pendant la mission devient une erreur PARLANTE.
      let image;
      try {
        // JPEG qualité 80 (natif Playwright) : ~5× plus léger que le PNG plein format envoyé
        // au modèle à CHAQUE action — latence d'upload en moins, lisibilité écran intacte.
        image = await page.screenshot({ type: 'jpeg', quality: 80, timeout: 10_000, animations: 'disabled' });
      } catch (error) {
        if (page.isClosed?.() || isBenignCursorError(error)) {
          throw new Error('Le navigateur a été fermé pendant la mission — relancez-la pour rouvrir une page.');
        }
        throw error;
      }
      const viewport = page.viewportSize() || DEFAULT_VIEWPORT;
      const rawElements = typeof page.evaluate === 'function' ? await page.evaluate(() => {
        const viewportWidth = Math.max(window.innerWidth, 1);
        const viewportHeight = Math.max(window.innerHeight, 1);
        return [...document.querySelectorAll('a,button,input,select,textarea,[role],[tabindex]')]
          .map((node) => {
            const rect = node.getBoundingClientRect();
            const style = getComputedStyle(node);
            const visible = rect.width > 0 && rect.height > 0
              && rect.bottom >= 0 && rect.right >= 0
              && rect.top <= viewportHeight && rect.left <= viewportWidth
              && style.display !== 'none' && style.visibility !== 'hidden'
              && node.getAttribute('aria-hidden') !== 'true';
            if (!visible || (node instanceof HTMLInputElement && node.type === 'hidden')) return null;
            const label = node.getAttribute('aria-label')
              || node.getAttribute('placeholder')
              || node.getAttribute('title')
              || node.textContent?.trim()
              || '';
            return {
              tag: node.tagName.toLowerCase(),
              type: node.getAttribute('type') || node.getAttribute('role') || '',
              label: label.slice(0, 160),
              x: Math.round(((rect.left + rect.width / 2) / viewportWidth) * 1_000),
              y: Math.round(((rect.top + rect.height / 2) / viewportHeight) * 1_000),
            };
          })
          .filter(Boolean)
          .slice(0, 120);
      }).catch(() => []) : [];
      const elements = Array.isArray(rawElements) ? rawElements.slice(0, 120) : [];
      return {
        imageBase64: image.toString('base64'),
        mimeType: 'image/jpeg',
        width: viewport.width,
        height: viewport.height,
        url: page.url(),
        elements,
      };
    },
    execute: async (action) => {
      const handler = handlers[action?.name];
      if (!handler) throw new Error(`Action navigateur interdite: ${action?.name}`);
      const result = await handler(action);
      if (result === undefined && (
        action.name.startsWith('inspect_') || action.name === 'get_page_source' || action.name === 'read_visible_text'
      )) {
        throw new Error('Observation web structurée indisponible.');
      }
      await settleAfterNavigation(action);
      return { executed: true, url: page.url(), ...(result === undefined ? {} : { inspection: result }) };
    },
    currentContext: async () => ({ app: 'Google Chrome', title: await page.title(), url: page.url() }),
    previewAction,
    hideCursor,
    isClosed: () => closed,
    getPage: () => page,
    close: async () => {
      if (closed) return;
      closed = true;
      await context.close();
    },
  });
}
