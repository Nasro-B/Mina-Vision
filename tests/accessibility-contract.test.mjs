// Contrat d'accessibilité (Task 22) : défauts ciblés verrouillés — label de la phrase de
// récupération, nom accessible des boutons icon-only, pas de plancher de largeur au-delà de
// 320 px, reduced-motion respecté. Parsing texte simple : le markup est la source de vérité.

import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const load = (relative) => readFile(new URL(`../src/ui/${relative}`, import.meta.url), 'utf8');

describe('contrat accessibilité (Task 22)', () => {
  it('la phrase de récupération a un label explicite lié au champ', async () => {
    const html = await load('index.html');
    expect(html).toContain('<label for="recovery-phrase"');
    expect(html).toMatch(/class="visually-hidden">[^<]*[Pp]hrase de récupération/u);
  });

  it('aucun conteneur principal n\'impose une largeur minimale au-delà de 320 px', async () => {
    const css = await load('styles.css');
    const bodyBlock = css.slice(css.indexOf('body {'), css.indexOf('}', css.indexOf('body {')));
    const minWidth = /min-width:\s*(\d+)px/u.exec(bodyBlock);
    expect(minWidth).not.toBeNull();
    expect(Number(minWidth[1])).toBeLessThanOrEqual(320);
  });

  it('tous les boutons icon-only (SVG sans texte) portent un nom accessible', async () => {
    const html = await load('index.html');
    const buttons = html.match(/<button\b[^>]*>[\s\S]*?<\/button>/gu) ?? [];
    const offenders = buttons.filter((button) => {
      const inner = button.replace(/^<button\b[^>]*>/u, '').replace(/<\/button>$/u, '');
      const textOnly = inner.replace(/<[^>]+>/gu, '').replace(/\s+/gu, '');
      const hasVisibleText = textOnly.length > 0;
      const opening = button.slice(0, button.indexOf('>') + 1);
      const hasAccessibleName = /aria-label=|aria-labelledby=|title=/u.test(opening);
      return !hasVisibleText && !hasAccessibleName;
    });
    expect(offenders).toEqual([]);
  });

  it('prefers-reduced-motion est respecté par la feuille de style', async () => {
    const css = await load('styles.css');
    expect(css).toContain('prefers-reduced-motion');
  });

  it('la classe visually-hidden existe et cache sans retirer du flux accessible', async () => {
    const css = await load('styles.css');
    expect(css).toContain('.visually-hidden');
    expect(css).toMatch(/\.visually-hidden\s*\{[^}]*clip:/u);
  });
});
