import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { PDF_THEMES, generatePdf } from '../src/publication/pdf-generator.mjs';

// PNG 1×1 transparent valide (magic bytes réels) pour tester l'embarquement d'image.
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

describe('pdf-generator', () => {
  it('génère un PDF paginé (>1 page) avec Unicode latin, image, tableau, pied de page', async () => {
    const blocks = [
      { kind: 'heading', text: 'Résultats — é, €, à, ç', level: 1 },
      ...Array.from({ length: 60 }, (_, index) => ({
        kind: 'paragraph',
        text: `Paragraphe ${index} : accents é è à ç, symbole €, texte de remplissage pour forcer une pagination réelle sur plusieurs pages A4.`,
      })),
      { kind: 'table', rows: [['Mois', 'Montant'], ['Janvier', '120 €'], ['Février', '90 €']] },
      { kind: 'image', assetId: 'img1', caption: 'Figure 1 — logo' },
    ];
    const assets = [{ assetId: 'img1', mimeType: 'image/png', bytes: PNG_1x1, dimensions: { width: 1, height: 1 } }];

    const pdf = await generatePdf({ title: 'Bilan 2026', blocks, assets, createdAt: '2026-07-29', theme: 'corporate-blue-v1' });

    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    const parsed = await PDFDocument.load(pdf);
    expect(parsed.getPageCount()).toBeGreaterThan(1);
  });

  it('sans police custom, un glyphe hors WinAnsi (arabe/CJK) est assaini, pas un crash', async () => {
    const pdf = await generatePdf({ title: 'Test 中文 العربية', blocks: [{ kind: 'paragraph', text: 'مرحبا 世界' }] });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('un tableau ne déborde jamais : une grande table reste dans un PDF valide', async () => {
    const rows = Array.from({ length: 80 }, (_, index) => [`Ligne ${index}`, `${index * 3}`, 'note']);
    const pdf = await generatePdf({ title: 'Grande table', blocks: [{ kind: 'table', rows }], createdAt: '2026-07-29' });
    const parsed = await PDFDocument.load(pdf);
    expect(parsed.getPageCount()).toBeGreaterThan(1);
  });

  it('expose les 4 thèmes nommés', () => {
    expect(Object.keys(PDF_THEMES)).toEqual(
      expect.arrayContaining(['mina-light-v1', 'mina-dark-v1', 'corporate-blue-v1', 'minimal-paper-v1']),
    );
  });
});
