import { describe, expect, it } from 'vitest';
import { ILLUSTRATION_KINDS, createIllustration } from '../src/publication/illustration-generator.mjs';

describe('illustration-generator : SVG local, échappé, déterministe', () => {
  it('génère les 7 types en SVG avec provenance procédurale', () => {
    for (const kind of ILLUSTRATION_KINDS) {
      const result = createIllustration({ kind, data: { values: [1, 2, 3], steps: ['a', 'b'], quote: 'x', cols: 3, rows: 2 } });
      expect(result.mimeType).toBe('image/svg+xml');
      expect(result.provenance).toBe('procedural');
      expect(result.bytes.toString('utf8')).toMatch(/^<svg[\s>]/u);
      expect(result.sha256).toMatch(/^[a-f0-9]{64}$/u);
    }
    expect(ILLUSTRATION_KINDS).toHaveLength(7);
  });

  it('est déterministe : même entrée → même octets et même hash', () => {
    const input = { kind: 'bar-chart', data: { values: [4, 8, 2], labels: ['T1', 'T2', 'T3'] }, palette: { accent: '#2563eb' } };
    const a = createIllustration(input);
    const b = createIllustration(input);
    expect(a.sha256).toBe(b.sha256);
    expect(Buffer.compare(a.bytes, b.bytes)).toBe(0);
  });

  it('échappe tout texte injecté (aucune balise active dans le SVG)', () => {
    const result = createIllustration({ kind: 'quote-card', data: { quote: '</text><script>alert(1)</script>', author: 'A & B' } });
    const svg = result.bytes.toString('utf8');
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;script&gt;');
    expect(svg).toContain('A &amp; B');
  });

  it('refuse une couleur hors format #RRGGBB', () => {
    expect(() => createIllustration({ kind: 'background', palette: { from: 'red' } }))
      .toThrow('publication_illustration_color_invalid');
    expect(() => createIllustration({ kind: 'background', palette: { to: '#12345' } }))
      .toThrow('publication_illustration_color_invalid');
  });

  it('refuse un type inconnu', () => {
    expect(() => createIllustration({ kind: 'mandala' })).toThrow('publication_illustration_kind_invalid');
  });

  it('borne les dimensions (jamais 0 ni démesuré)', () => {
    const tiny = createIllustration({ kind: 'background', width: 1, height: 1 });
    expect(tiny.bytes.toString('utf8')).toContain('width="16"');
    const huge = createIllustration({ kind: 'background', width: 999999, height: 999999 });
    expect(huge.bytes.toString('utf8')).toContain('width="8192"');
  });
});
