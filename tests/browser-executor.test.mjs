import { describe, expect, it, vi } from 'vitest';
import { createBrowserExecutor } from '../src/executors/browser-executor.mjs';

function createBrowserFake() {
  const page = {
    screenshot: vi.fn(async () => Buffer.from('png')),
    viewportSize: vi.fn(() => ({ width: 1_440, height: 900 })),
    title: vi.fn(async () => 'Fixture'),
    url: vi.fn(() => 'https://example.com/'),
    evaluate: vi.fn(async () => true),
    goto: vi.fn(), goBack: vi.fn(), goForward: vi.fn(),
    waitForTimeout: vi.fn(),
    mouse: {
      click: vi.fn(), move: vi.fn(), down: vi.fn(), up: vi.fn(), wheel: vi.fn(),
    },
    keyboard: { insertText: vi.fn(), press: vi.fn(), down: vi.fn(), up: vi.fn() },
  };
  const context = {
    pages: vi.fn(() => [page]),
    newPage: vi.fn(async () => page),
    on: vi.fn(),
    close: vi.fn(),
  };
  return { page, context, launchContext: vi.fn(async () => context) };
}

describe('browser executor', () => {
  it('observes without persisting screenshots', async () => {
    const fake = createBrowserFake();
    const executor = await createBrowserExecutor({ launchContext: fake.launchContext });

    await expect(executor.observe()).resolves.toEqual({
      imageBase64: Buffer.from('png').toString('base64'),
      mimeType: 'image/jpeg',
      width: 1_440,
      height: 900,
      url: 'https://example.com/',
      elements: [],
    });
    expect(executor.getPage()).toBe(fake.page);
  });

  it('executes click, scroll, type, key, and navigation actions', async () => {
    const fake = createBrowserFake();
    const executor = await createBrowserExecutor({ launchContext: fake.launchContext });

    await executor.execute({ name: 'click', x: 10, y: 20 });
    await executor.execute({ name: 'scroll', x: 30, y: 40, scrollX: 5, scrollY: 100 });
    await executor.execute({ name: 'type', text: 'Mina', pressEnter: true });
    await executor.execute({ name: 'key', keys: ['CTRL', 'A'] });
    await executor.execute({ name: 'navigate', url: 'https://example.com/' });
    await executor.execute({ name: 'triple_click', x: 15, y: 25 });
    await executor.execute({ name: 'middle_click', x: 20, y: 30 });
    await executor.execute({ name: 'key_down', keys: ['CTRL'] });
    await executor.execute({ name: 'key_up', keys: ['CTRL'] });

    expect(fake.page.mouse.click).toHaveBeenCalledWith(10, 20, { button: 'left', clickCount: 1 });
    expect(fake.page.mouse.wheel).toHaveBeenCalledWith(5, 100);
    expect(fake.page.keyboard.insertText).toHaveBeenCalledWith('Mina');
    expect(fake.page.keyboard.press).toHaveBeenCalledWith('Enter');
    expect(fake.page.keyboard.press).toHaveBeenCalledWith('Control+A');
    expect(fake.page.goto).toHaveBeenCalledWith('https://example.com/', expect.any(Object));
    expect(fake.page.mouse.click).toHaveBeenCalledWith(15, 25, { button: 'left', clickCount: 3 });
    expect(fake.page.mouse.click).toHaveBeenCalledWith(20, 30, { button: 'middle', clickCount: 1 });
    expect(fake.page.keyboard.down).toHaveBeenCalledWith('Control');
    expect(fake.page.keyboard.up).toHaveBeenCalledWith('Control');
  });

  it('refuses to report typing as executed when no editable field has focus', async () => {
    const fake = createBrowserFake();
    fake.page.evaluate = vi.fn(async () => false);
    const executor = await createBrowserExecutor({ launchContext: fake.launchContext });

    await expect(executor.execute({ name: 'type', text: 'Cheb Hasni', pressEnter: true }))
      .rejects.toThrow('browser_text_target_not_focused');
    expect(fake.page.keyboard.insertText).not.toHaveBeenCalled();
  });

  it('focuses an explicitly grounded editable target before typing', async () => {
    const fake = createBrowserFake();
    fake.page.evaluate = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const executor = await createBrowserExecutor({ launchContext: fake.launchContext });

    await expect(executor.execute({ name: 'type', text: 'Cheb Hasni', x: 400, y: 30, replaceText: true }))
      .resolves.toMatchObject({ executed: true });
    expect(fake.page.mouse.click).toHaveBeenCalledWith(400, 30, { button: 'left', clickCount: 1 });
    expect(fake.page.keyboard.press).toHaveBeenCalledWith('Control+A');
    expect(fake.page.keyboard.insertText).toHaveBeenCalledWith('Cheb Hasni');
  });

  it('adds bounded normalized coordinates for visible interactive elements', async () => {
    const fake = createBrowserFake();
    fake.page.evaluate = vi.fn(async () => [{
      tag: 'input', type: 'text', label: 'Rechercher', x: 500, y: 72,
    }]);
    const executor = await createBrowserExecutor({ launchContext: fake.launchContext });

    await expect(executor.observe()).resolves.toMatchObject({
      elements: [{ tag: 'input', type: 'text', label: 'Rechercher', x: 500, y: 72 }],
    });
  });

  it('follows a newly opened tab instead of continuing to act on a stale page', async () => {
    const fake = createBrowserFake();
    let onPage;
    fake.context.on.mockImplementation((event, listener) => {
      if (event === 'page') onPage = listener;
    });
    const executor = await createBrowserExecutor({ launchContext: fake.launchContext });
    const nextPage = {
      ...fake.page,
      screenshot: vi.fn(async () => Buffer.from('next-tab')),
      url: vi.fn(() => 'https://www.youtube.com/'),
      title: vi.fn(async () => 'YouTube'),
    };

    onPage(nextPage);

    await expect(executor.observe()).resolves.toMatchObject({
      imageBase64: Buffer.from('next-tab').toString('base64'),
      url: 'https://www.youtube.com/',
    });
    expect(executor.getPage()).toBe(nextPage);
  });

  it('shows a non-interactive Mina cursor and hides it before verification', async () => {
    const fake = createBrowserFake();
    const executor = await createBrowserExecutor({ launchContext: fake.launchContext });

    await executor.previewAction({ name: 'click', x: 120, y: 80 }, { safety: { decision: 'allow' } });
    await executor.hideCursor();

    expect(fake.page.evaluate).toHaveBeenNthCalledWith(1, expect.any(Function), expect.objectContaining({
      name: 'click', x: 120, y: 80, decision: 'allow',
    }));
    expect(fake.page.evaluate).toHaveBeenNthCalledWith(2, expect.any(Function));
  });

  it('renders the Mina cursor without an HTML sink on Trusted Types pages', async () => {
    const fake = createBrowserFake();
    const appended = [];
    const createElement = (tagName) => ({
      tagName,
      children: [],
      style: { cssText: '' },
      setAttribute: vi.fn(),
      append(...children) { this.children.push(...children); },
      set innerHTML(_value) { throw new TypeError("This document requires 'TrustedHTML' assignment."); },
    });
    const trustedTypesDocument = {
      querySelector: vi.fn(() => null),
      createElement: vi.fn(createElement),
      documentElement: { append: vi.fn((node) => appended.push(node)) },
    };
    fake.page.evaluate.mockImplementation(async (callback, payload) => {
      const previousDocument = globalThis.document;
      globalThis.document = trustedTypesDocument;
      try {
        return callback(payload);
      } finally {
        globalThis.document = previousDocument;
      }
    });
    const executor = await createBrowserExecutor({ launchContext: fake.launchContext });

    await expect(executor.previewAction({ name: 'click', x: 120, y: 80 }))
      .resolves.toEqual({ visible: true });
    expect(appended).toHaveLength(1);
    expect(appended[0].children).toHaveLength(2);
    expect(appended[0].children[1].textContent).toBe('Mina · click');
  });

  it('does not evaluate cursor scripts after the browser page has closed', async () => {
    const fake = createBrowserFake();
    fake.page.isClosed = vi.fn(() => true);
    fake.page.evaluate = vi.fn(async () => {
      throw new Error('page.evaluate: Target page, context or browser has been closed');
    });
    const executor = await createBrowserExecutor({ launchContext: fake.launchContext });

    await expect(executor.previewAction({ name: 'click', x: 120, y: 80 }))
      .resolves.toEqual({ visible: false });
    await expect(executor.hideCursor()).resolves.toEqual({ visible: false });
    expect(fake.page.evaluate).not.toHaveBeenCalled();
  });

  it('treats a page closed during cursor evaluation as an unavailable overlay', async () => {
    const fake = createBrowserFake();
    fake.page.isClosed = vi.fn(() => false);
    fake.page.evaluate = vi.fn(async () => {
      throw new Error('page.evaluate: Target page, context or browser has been closed');
    });
    const executor = await createBrowserExecutor({ launchContext: fake.launchContext });

    await expect(executor.previewAction({ name: 'click', x: 120, y: 80 }))
      .resolves.toEqual({ visible: false });
    await expect(executor.hideCursor()).resolves.toEqual({ visible: false });
  });

  it('treats an execution context destroyed by navigation as an unavailable overlay, not an error', async () => {
    // Regression: clicking a link starts a navigation; the cosmetic cursor overlay then races the
    // page teardown and page.evaluate throws « Execution context was destroyed ». That must never
    // surface as cursor_error in the technical journal — the overlay is redrawn on the next action.
    const fake = createBrowserFake();
    fake.page.isClosed = vi.fn(() => false);
    fake.page.evaluate = vi.fn(async () => {
      throw new Error('page.evaluate: Execution context was destroyed, most likely because of a navigation');
    });
    const executor = await createBrowserExecutor({ launchContext: fake.launchContext });

    await expect(executor.previewAction({ name: 'click', x: 120, y: 80 }))
      .resolves.toEqual({ visible: false });
    await expect(executor.hideCursor()).resolves.toEqual({ visible: false });
  });

  it('names the element that actually holds focus when typing has no editable target', async () => {
    // The model keeps retrying blind « type » actions when the error carries no context. Telling it
    // WHAT holds focus (body, a button…) lets it self-correct with a click on the right field.
    const fake = createBrowserFake();
    const answers = [false, false, undefined, false, 'body']; // probe, probe after click, nearest-focus rescue, probe, tag
    fake.page.evaluate = vi.fn(async () => answers.shift());
    const executor = await createBrowserExecutor({ launchContext: fake.launchContext });

    await expect(executor.execute({ name: 'type', text: 'Cheb Hasni', x: 10, y: 20 }))
      .rejects.toThrow('browser_text_target_not_focused:body');
    expect(fake.page.keyboard.insertText).not.toHaveBeenCalled();
  });

  it('recovers a near-miss click by focusing the closest editable field, then types', async () => {
    // The « :body » errors in the field journal showed the model clicking a few pixels OUTSIDE the
    // search box (icon, padding): focus lands on body and the mission loops. The executor now
    // focuses the nearest visible editable element around the click point before giving up.
    const fake = createBrowserFake();
    const answers = [false, false, undefined, true]; // probe, probe after click, nearest-focus rescue, probe → focused
    fake.page.evaluate = vi.fn(async () => answers.shift());
    const executor = await createBrowserExecutor({ launchContext: fake.launchContext });

    await executor.execute({ name: 'type', text: 'Cheb Hasni', x: 10, y: 20, pressEnter: true });

    expect(fake.page.keyboard.insertText).toHaveBeenCalledWith('Cheb Hasni');
    // The rescue evaluate receives the click point so the search stays local to it.
    expect(fake.page.evaluate.mock.calls[2][1]).toEqual({ x: 10, y: 20 });
  });

  it('reports a context closed by the user so the main process can recreate it', async () => {
    const fake = createBrowserFake();
    let closeListener;
    fake.context.on.mockImplementation((event, listener) => {
      if (event === 'close') closeListener = listener;
    });
    const executor = await createBrowserExecutor({ launchContext: fake.launchContext });

    expect(executor.isClosed()).toBe(false);
    closeListener();
    expect(executor.isClosed()).toBe(true);
  });
});

describe('browser executor: mission latency', () => {
  it('keeps mission observations light: no structured web payload in observe()', async () => {
    const fake = createBrowserFake();
    fake.page.locator = vi.fn();
    const webObserver = { observe: vi.fn(), inspect: vi.fn(async () => ({ ok: true })) };
    const executor = await createBrowserExecutor({
      launchContext: fake.launchContext,
      webObserverFactory: () => webObserver,
    });

    const observation = await executor.observe();

    expect(observation.web).toBeUndefined();
    expect(webObserver.observe).not.toHaveBeenCalled();
    await executor.execute({ name: 'inspect_dom', sourceAuthorized: true });
    expect(webObserver.inspect).toHaveBeenCalled();
  });

  it('settles after navigation-triggering actions so the post-action screenshot is not a loading page', async () => {
    const fake = createBrowserFake();
    fake.page.waitForLoadState = vi.fn(async () => {});
    const executor = await createBrowserExecutor({ launchContext: fake.launchContext });

    await executor.execute({ name: 'click', x: 10, y: 20 });
    await executor.execute({ name: 'type', text: 'météo', pressEnter: true });
    await executor.execute({ name: 'key', keys: ['ENTER'] });
    expect(fake.page.waitForLoadState).toHaveBeenCalledTimes(3);

    fake.page.waitForLoadState.mockClear();
    await executor.execute({ name: 'move', x: 5, y: 5 });
    await executor.execute({ name: 'scroll', x: 5, y: 5, scrollY: 100 });
    await executor.execute({ name: 'type', text: 'sans entrée' });
    expect(fake.page.waitForLoadState).not.toHaveBeenCalled();
  });

  it('never fails the action itself when the settle wait times out', async () => {
    const fake = createBrowserFake();
    fake.page.waitForLoadState = vi.fn(async () => { throw new Error('Timeout 2500ms exceeded'); });
    const executor = await createBrowserExecutor({ launchContext: fake.launchContext });

    await expect(executor.execute({ name: 'click', x: 10, y: 20 })).resolves.toMatchObject({ executed: true });
  });

  it('bounds the screenshot, freezes animations, and speaks plainly when the browser was closed', async () => {
    // Real journal 21:09: page.screenshot hung 30 s on a video page, then « Target page, context
    // or browser has been closed » killed the mission with raw Playwright jargon.
    const fake = createBrowserFake();
    const executor = await createBrowserExecutor({ launchContext: fake.launchContext });
    await executor.observe();
    expect(fake.page.screenshot).toHaveBeenCalledWith({ type: 'jpeg', quality: 80, timeout: 10_000, animations: 'disabled' });

    const closing = createBrowserFake();
    closing.page.screenshot = vi.fn(async () => {
      throw new Error('page.screenshot: Target page, context or browser has been closed');
    });
    const closedExecutor = await createBrowserExecutor({ launchContext: closing.launchContext });
    await expect(closedExecutor.observe()).rejects.toThrow('Le navigateur a été fermé pendant la mission');
  });
});
