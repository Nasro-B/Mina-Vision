import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const loadUi = (relative) => readFile(new URL(`../src/ui/${relative}`, import.meta.url), 'utf8');

describe('UI polish contract', () => {
  it('every static button in index.html declares an explicit design class', async () => {
    const html = await loadUi('index.html');
    const buttons = html.match(/<button\b[^>]*>/gu) ?? [];
    const bareButtons = buttons.filter((button) => !/\sclass="/u.test(button));

    expect(bareButtons).toEqual([]);
  });

  it('does not use emoji as a structural alert icon', async () => {
    const html = await loadUi('index.html');

    expect(html).not.toContain('⚠️');
  });

  it('defines shared professional button and panel primitives', async () => {
    const css = await loadUi('styles.css');

    expect(css).toContain('.action-button');
    expect(css).toContain('.surface-panel');
    expect(css).toMatch(/\.action-button[^{]*\{[^}]*min-height:\s*44px/su);
    expect(css).toContain('button:not(:disabled):active');
  });
});
