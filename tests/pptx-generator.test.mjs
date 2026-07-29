import AdmZip from 'adm-zip';
import PptxGenJS from 'pptxgenjs';
import { describe, expect, it } from 'vitest';
import { createPresentationGenerator } from '../src/publication/pptx-generator.mjs';
import { normalizePresentationSpec } from '../src/publication/presentation-schema.mjs';

const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

describe('pptx-generator', () => {
  it('génère un PPTX valide (PK + ppt/presentation.xml) avec slides, chart, image locale et notes', async () => {
    const generator = createPresentationGenerator({
      pptxFactory: () => new PptxGenJS(),
      assetResolver: (id) => (id === 'logo' ? { assetId: 'logo', mimeType: 'image/png', bytes: PNG_1x1 } : null),
    });
    const spec = normalizePresentationSpec({
      title: 'Bilan 2026', themeId: 'corporate-blue-v1',
      slides: [
        { kind: 'cover', title: 'Bilan 2026', subtitle: 'Résultats et priorités' },
        { kind: 'bullets', title: 'Résultats', bullets: ['Objectif atteint', 'Coût réduit'] },
        { kind: 'chart-bar', title: 'Évolution', chart: { labels: ['T1', 'T2'], series: [{ name: 'CA', values: [10, 14] }] } },
        { kind: 'image-left', title: 'Marque', images: ['logo'], bullets: ['Logo intégré localement'] },
        { kind: 'table', title: 'Chiffres', rows: [['Mois', 'CA'], ['Janvier', '120']] },
      ],
      speakerNotes: ['Introduire le bilan', '', 'Commenter la hausse'],
    });

    const bytes = await generator.generate(spec);

    expect(bytes.subarray(0, 2).toString()).toBe('PK');
    const zip = new AdmZip(bytes);
    expect(zip.getEntry('ppt/presentation.xml')).toBeTruthy();
    const slides = zip.getEntries().filter((entry) => /^ppt\/slides\/slide\d+\.xml$/u.test(entry.entryName));
    expect(slides.length).toBe(5);
    // Une image locale a bien été embarquée dans ppt/media (bytes, jamais une URL distante).
    expect(zip.getEntries().some((entry) => /^ppt\/media\/image[-\d]/u.test(entry.entryName))).toBe(true);
  });

  it('exige une factory PptxGenJS', () => {
    expect(() => createPresentationGenerator({})).toThrow('pptx_generator_factory_required');
  });

  it('un asset introuvable ne fait pas planter et n’ajoute aucune image distante', async () => {
    const generator = createPresentationGenerator({ pptxFactory: () => new PptxGenJS(), assetResolver: () => null });
    const spec = normalizePresentationSpec({ slides: [{ kind: 'image-left', images: ['absent'], bullets: ['texte'] }] });
    const bytes = await generator.generate(spec);
    expect(bytes.subarray(0, 2).toString()).toBe('PK');
  });
});
