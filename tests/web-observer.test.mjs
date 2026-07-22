import { describe, expect, it, vi } from 'vitest';
import { createWebObserver } from '../src/perception/web-observer.mjs';

function page() {
  return {
    url: () => 'https://example.test/path?token=URL_SECRET&view=ok',
    evaluate: vi.fn(async () => ({
      title: 'Fixture',
      visibleText: 'Texte visible token="INLINE_SECRET"',
      interactive: [
        { tag: 'input', type: 'password', value: 'PASSWORD_SECRET', text: '', ariaLabel: 'Mot de passe' },
        { tag: 'button', type: 'submit', value: '', text: 'Chercher', ariaLabel: '' },
      ],
      dom: '<main><input type="hidden" value="HIDDEN_SECRET" data-token="DOM_SECRET"><button>Chercher</button></main>',
      scripts: [{ src: '/app.js?token=SCRIPT_SECRET', inline: 'const token="JS_SECRET"' }],
      styles: ['button { color: red; }'],
    })),
    locator: () => ({ ariaSnapshot: async () => '- textbox "Mot de passe": PASSWORD_SECRET\n- button "Chercher"' }),
  };
}

describe('bounded web observer', () => {
  it('returns visible structure and sanitized code without browser stores or secrets', async () => {
    const observer = createWebObserver({ page: page(), limits: { text: 100, dom: 300, scripts: 200, accessibility: 200 } });
    const result = await observer.observe();
    const serialized = JSON.stringify(result);

    expect(result).toMatchObject({ title: 'Fixture', url: expect.stringContaining('token=%5BREDACTED%5D') });
    expect(result.interactive).toContainEqual(expect.objectContaining({ tag: 'button', text: 'Chercher' }));
    expect(serialized).not.toMatch(/PASSWORD_SECRET|HIDDEN_SECRET|DOM_SECRET|SCRIPT_SECRET|JS_SECRET|INLINE_SECRET/u);
    expect(serialized).not.toMatch(/localStorage|sessionStorage|cookie/u);
  });

  it('requires explicit web.source.read authorization for page source', async () => {
    const observer = createWebObserver({ page: page() });
    await expect(observer.inspect('get_page_source')).rejects.toThrow('web_source_authorization_required');
    await expect(observer.inspect('get_page_source', { sourceAuthorized: true })).resolves.toMatchObject({ kind: 'dom' });
    await expect(observer.inspect('read_visible_text')).resolves.toMatchObject({ kind: 'visible_text' });
  });
});
