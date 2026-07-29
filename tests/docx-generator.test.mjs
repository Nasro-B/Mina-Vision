import AdmZip from 'adm-zip';
import { describe, expect, it } from 'vitest';
import { generateDocx } from '../src/publication/docx-generator.mjs';

const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

describe('docx-generator', () => {
  it('génère un DOCX ouvrable (PK) avec titre, tableau, image et pied de page', async () => {
    const blocks = [
      { kind: 'heading', text: 'Rapport — é € 中文 (Unicode natif)', level: 1 },
      { kind: 'paragraph', text: 'Corps avec accents é è à ç et symbole €.' },
      { kind: 'bullets', items: ['Objectif atteint', 'Coût réduit'] },
      { kind: 'quote', text: 'Une citation en retrait.' },
      { kind: 'table', rows: [['Mois', 'Montant'], ['Janvier', '120'], ['Février', '90']] },
      { kind: 'image', assetId: 'img1', caption: 'Figure 1' },
    ];
    const assets = [{ assetId: 'img1', mimeType: 'image/png', bytes: PNG_1x1, dimensions: { width: 1, height: 1 } }];

    const docx = await generateDocx({ title: 'Rapport', blocks, assets, createdAt: '2026-07-29' });

    expect(docx.subarray(0, 2).toString()).toBe('PK'); // ZIP = DOCX ouvrable
    const documentXml = new AdmZip(docx).readAsText('word/document.xml');
    expect(documentXml).toContain('w:tbl'); // le tableau est bien présent
    expect(documentXml).toContain('Rapport'); // le titre est dans le corps
    // Unicode natif : l'arabe/CJK n'est PAS remplacé (contrairement au PDF sans police custom).
    expect(documentXml).toContain('中文');
  });

  it('génère un DOCX même sans blocs (juste le titre)', async () => {
    const docx = await generateDocx({ title: 'Vide', blocks: [] });
    expect(docx.subarray(0, 2).toString()).toBe('PK');
  });
});
