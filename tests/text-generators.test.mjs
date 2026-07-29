import { describe, expect, it } from 'vitest';
import { generateText } from '../src/publication/text-generators.mjs';
import { normalizePublicationRequest } from '../src/publication/publication-schema.mjs';

const request = normalizePublicationRequest({
  title: 'Bilan', format: 'md',
  blocks: [
    { kind: 'heading', text: 'Résultats', level: 1 },
    { kind: 'paragraph', text: 'Texte <b>brut</b> avec & et "guillemets".' },
    { kind: 'bullets', items: ['Point A', 'Point B'] },
    { kind: 'table', rows: [['Mois', 'Montant'], ['=SUM(A1)', '120']] },
  ],
});

describe('text-generators', () => {
  it('markdown : titre, puces et tableau', () => {
    const md = generateText('md', request).toString('utf8');
    expect(md).toContain('# Bilan');
    expect(md).toContain('- Point A');
    expect(md).toContain('| Mois | Montant |');
  });

  it('html : tout échappé, aucune balise active, aucune URL distante, style local', () => {
    const html = generateText('html', request).toString('utf8');
    expect(html).toContain('<!doctype html>');
    expect(html).not.toContain('<b>brut</b>');
    expect(html).toContain('&lt;b&gt;brut&lt;/b&gt;');
    expect(html).not.toContain('<script');
    expect(html).not.toMatch(/https?:\/\//u);
  });

  it('csv : BOM, délimiteur « ; » et neutralisation d’une cellule formule (=)', () => {
    const csv = generateText('csv', request).toString('utf8');
    expect(csv.charCodeAt(0)).toBe(0xFEFF); // BOM UTF-8
    expect(csv).toContain('Mois;Montant');
    expect(csv).toContain("'=SUM(A1)"); // le = est neutralisé par une apostrophe
  });

  it('json : requête normalisée sérialisée + origine', () => {
    const json = JSON.parse(generateText('json', request).toString('utf8'));
    expect(json.generatedBy).toBe('Mina Vision');
    expect(json.request.title).toBe('Bilan');
    expect(json.request.blocks).toHaveLength(4);
  });

  it('refuse un format non textuel', () => {
    expect(() => generateText('pdf', request)).toThrow('publication_text_format_invalid');
  });
});
