import { describe, expect, it } from 'vitest';
import {
  PRESENTATION_LIMITS, SLIDE_KINDS, normalizePresentationSpec,
} from '../src/publication/presentation-schema.mjs';

describe('presentation-schema', () => {
  it('normalise une présentation valide, thème par défaut si inconnu', () => {
    const spec = normalizePresentationSpec({
      title: 'Bilan 2026', themeId: 'inconnu',
      slides: [{ kind: 'cover', title: 'Bilan', subtitle: 'Sous-titre' }],
    });
    expect(spec.themeId).toBe('mina-light-v1'); // repli non-throw
    expect(spec.slides[0]).toMatchObject({ kind: 'cover', title: 'Bilan', subtitle: 'Sous-titre' });
    expect(Object.isFrozen(spec.slides)).toBe(true);
  });

  it('accepte les 13 kinds de slide', () => {
    expect(SLIDE_KINDS).toHaveLength(13);
    for (const kind of SLIDE_KINDS) {
      expect(() => normalizePresentationSpec({ slides: [{ kind, title: 'x' }] })).not.toThrow();
    }
  });

  it('refuse un kind de slide inconnu', () => {
    expect(() => normalizePresentationSpec({ slides: [{ kind: 'hologram' }] })).toThrow('publication_slide_kind_invalid');
  });

  it('borne le nombre de slides, de puces et la longueur des puces', () => {
    const tooMany = Array.from({ length: PRESENTATION_LIMITS.slides + 1 }, () => ({ kind: 'section', title: 'x' }));
    expect(() => normalizePresentationSpec({ slides: tooMany })).toThrow('publication_presentation_too_many_slides');

    const spec = normalizePresentationSpec({
      slides: [{ kind: 'bullets', title: 'T', bullets: Array.from({ length: 30 }, () => 'a'.repeat(300)) }],
    });
    expect(spec.slides[0].bullets.length).toBe(PRESENTATION_LIMITS.bullets);
    expect(spec.slides[0].bullets[0].length).toBe(PRESENTATION_LIMITS.bulletLength);
  });

  it('refuse un schéma exécutable dans un texte de slide', () => {
    expect(() => normalizePresentationSpec({ slides: [{ kind: 'quote', quote: 'javascript:alert(1)' }] }))
      .toThrow('publication_presentation_text_scheme_forbidden');
  });

  it('normalise un chart en séries numériques bornées', () => {
    const spec = normalizePresentationSpec({
      slides: [{ kind: 'chart-bar', title: 'Évolution', chart: { labels: ['T1', 'T2'], series: [{ name: 'CA', values: [10, 'x', 14] }] } }],
    });
    expect(spec.slides[0].chart.series[0].values).toEqual([10, 0, 14]);
  });
});
