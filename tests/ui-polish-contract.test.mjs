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

  it('centralise les états visuels des boutons sans micro-déplacement', async () => {
    const css = await loadUi('styles.css');

    expect(css).toContain('--button-radius:');
    expect(css).toContain('--button-shadow:');
    expect(css).toContain('--button-shadow-hover:');
    expect(css).toMatch(/\.action-button[^{]*\{[^}]*border-radius:\s*var\(--button-radius\)/su);
    expect(css).toMatch(/\.action-button[^{]*\{[^}]*box-shadow:\s*var\(--button-shadow\)/su);
    expect(css).toMatch(/\.action-button:not\(:disabled\):hover[^{]*\{[^}]*box-shadow:\s*var\(--button-shadow-hover\)/su);
    expect(css).not.toContain('transform: translateY(1px);');
  });

  it('garde les contrôles secondaires cohérents et accessibles au tactile', async () => {
    const css = await loadUi('styles.css');
    const secondaryButtonBlock = /:where\([\s\S]*?\.memory-controls button:not\(\.action-button\)[\s\S]*?\.provider-grid button:not\(\.action-button\)[\s\S]*?\)\s*\{(?<body>[^}]*)\}/u.exec(css)?.groups?.body ?? '';

    expect(secondaryButtonBlock).toContain('min-height: 40px');
    expect(secondaryButtonBlock).toContain('border-radius: var(--button-radius)');
  });

  it('désactive les transitions et translations bouton en reduced-motion', async () => {
    const css = await loadUi('styles.css');
    const reducedMotionBlock = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));

    expect(reducedMotionBlock).toContain('transition-duration: 0.001ms !important');
    expect(reducedMotionBlock).toContain('button:not(:disabled):active { transform: none; }');
  });
});
