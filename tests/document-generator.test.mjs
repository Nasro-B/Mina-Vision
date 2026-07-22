import { describe, expect, it } from 'vitest';
import {
  createDocumentGenerator,
  normalizeSections,
  slugifyTitle,
} from '../src/documents/document-generator.mjs';

function createMemFs(existing = new Set()) {
  const written = new Map();
  return {
    written,
    mkdir: async () => {},
    access: async (path) => {
      if (!existing.has(path) && !written.has(path)) throw new Error('ENOENT');
    },
    writeFile: async (path, buffer) => { written.set(path, buffer); },
  };
}

const CLOCK = () => new Date(2026, 6, 22, 9, 5, 3);

function buildGenerator({ existing } = {}) {
  const memFs = createMemFs(existing);
  const generator = createDocumentGenerator({ outputDirectory: 'C:/Docs/Mina Vision', fs: memFs, now: CLOCK });
  return { generator, memFs };
}

describe('slugifyTitle / normalizeSections', () => {
  it('slug sans accents ni caractères spéciaux, borné, jamais vide', () => {
    expect(slugifyTitle('Rapport Été — Bilan N°1 !')).toBe('rapport-ete-bilan-n-1');
    expect(slugifyTitle('///')).toBe('document');
    expect(slugifyTitle('x'.repeat(200)).length).toBeLessThanOrEqual(60);
  });

  it('texte brut : blocs vides séparés = paragraphes, ## = sections', () => {
    const sections = normalizeSections({
      content: 'Intro ligne 1\nsuite.\n\n## Première partie\n\nParagraphe A.\n\nParagraphe B.\n\n## Deuxième\n\nFin.',
    });
    expect(sections).toEqual([
      { heading: null, paragraphs: ['Intro ligne 1 suite.'] },
      { heading: 'Première partie', paragraphs: ['Paragraphe A.', 'Paragraphe B.'] },
      { heading: 'Deuxième', paragraphs: ['Fin.'] },
    ]);
  });

  it('sections structurées prioritaires sur content, nettoyées', () => {
    const sections = normalizeSections({
      content: 'ignoré',
      sections: [{ heading: '  Titre  ', paragraphs: ['  a  ', '', null] }, { paragraphs: [] }],
    });
    expect(sections).toEqual([{ heading: 'Titre', paragraphs: ['a'] }]);
  });
});

describe('document-generator', () => {
  it('valide dossier, fs, format, titre et contenu', async () => {
    expect(() => createDocumentGenerator({})).toThrow(/output_directory_required/u);
    const { generator } = buildGenerator();
    await expect(generator.generate({ format: 'txt', title: 'x', content: 'y' })).rejects.toThrow(/format_invalid/u);
    await expect(generator.generate({ format: 'pdf', title: '  ', content: 'y' })).rejects.toThrow(/title_required/u);
    await expect(generator.generate({ format: 'pdf', title: 'x', content: '   ' })).rejects.toThrow(/content_required/u);
    await expect(generator.generate({ format: 'pdf', title: 'x', content: 'y'.repeat(200_001) })).rejects.toThrow(/content_too_large/u);
  });

  it('génère un PDF réel (en-tête %PDF, nom horodaté, dossier dédié)', async () => {
    const { generator, memFs } = buildGenerator();
    const result = await generator.generate({
      format: 'pdf',
      title: 'Rapport Mensuel',
      content: '## Résultats\n\nTout est vert.\n\nDeuxième paragraphe assez long pour forcer un retour à la ligne automatique dans la page A4 générée par le moteur.',
    });
    expect(result.filePath).toBe('C:/Docs/Mina Vision/rapport-mensuel-20260722-090503.pdf');
    expect(result.format).toBe('pdf');
    expect(result.sections).toBe(1);
    const buffer = memFs.written.get(result.filePath);
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
    expect(result.bytes).toBe(buffer.length);
    expect(result.bytes).toBeGreaterThan(500);
  });

  it('génère un DOCX réel (conteneur ZIP « PK »)', async () => {
    const { generator, memFs } = buildGenerator();
    const result = await generator.generate({
      format: 'docx',
      title: 'Lettre',
      sections: [{ heading: 'Objet', paragraphs: ['Bonjour, ceci est un test.'] }],
    });
    expect(result.filePath.endsWith('.docx')).toBe(true);
    const buffer = memFs.written.get(result.filePath);
    expect(buffer.subarray(0, 2).toString()).toBe('PK');
  });

  it('un PDF très long pagine sans jamais lever (multi-pages)', async () => {
    const { generator, memFs } = buildGenerator();
    const paragraphs = Array.from({ length: 120 }, (_, index) => `Paragraphe numéro ${index} avec du contenu qui occupe de la place.`);
    const result = await generator.generate({
      format: 'pdf',
      title: 'Document long',
      sections: [{ heading: 'Tout', paragraphs }],
    });
    const buffer = memFs.written.get(result.filePath);
    // Preuve réelle : recharger le PDF généré et compter ses pages.
    const { PDFDocument } = await import('pdf-lib');
    const reloaded = await PDFDocument.load(buffer);
    expect(reloaded.getPageCount()).toBeGreaterThan(1);
  });

  it('JAMAIS d\'écrasement : collision de nom → suffixe incrémenté', async () => {
    const existing = new Set(['C:/Docs/Mina Vision/note-20260722-090503.pdf']);
    const { generator } = buildGenerator({ existing });
    const result = await generator.generate({ format: 'pdf', title: 'Note', content: 'contenu' });
    expect(result.filePath).toBe('C:/Docs/Mina Vision/note-20260722-090503-2.pdf');
  });

  it('accents et apostrophes du titre survivent dans le document, pas dans le nom de fichier', async () => {
    const { generator } = buildGenerator();
    const result = await generator.generate({ format: 'pdf', title: "Bilan d'été — journée n°1", content: 'x' });
    expect(result.title).toBe("Bilan d'été — journée n°1");
    expect(result.filePath).toContain('bilan-d-ete-journee-n-1');
  });
});
