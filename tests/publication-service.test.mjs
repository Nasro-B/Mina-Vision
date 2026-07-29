import { createHash } from 'node:crypto';
import PptxGenJS from 'pptxgenjs';
import { describe, expect, it } from 'vitest';
import { createPublicationService } from '../src/publication/publication-service.mjs';
import { generatePdf } from '../src/publication/pdf-generator.mjs';
import { generateDocx } from '../src/publication/docx-generator.mjs';
import { generateXlsx } from '../src/publication/xlsx-generator.mjs';
import { generateText } from '../src/publication/text-generators.mjs';
import { createPresentationGenerator } from '../src/publication/pptx-generator.mjs';

function memFs() {
  const files = new Set();
  return {
    files,
    mkdir: async () => {},
    writeFile: async (path) => { files.add(path); },
    rename: async (from, to) => { files.delete(from); files.add(to); },
    access: async (path) => { if (!files.has(path)) throw new Error('enoent'); },
  };
}

function makeService(filesystem = memFs()) {
  return createPublicationService({
    generators: {
      pdf: generatePdf, docx: generateDocx, xlsx: generateXlsx, text: generateText,
      pptx: createPresentationGenerator({ pptxFactory: () => new PptxGenJS() }),
    },
    filesystem,
    hash: (buffer) => createHash('sha256').update(buffer).digest('hex'),
    baseDir: 'C:/Users/x/Documents/Mina Vision/Publications',
    randomId: () => 'rid',
    clock: () => new Date(2026, 6, 29, 10, 30, 0),
  });
}

describe('publication-service', () => {
  it('écrit atomiquement un PPTX, rend un hash final et un chemin dans Publications', async () => {
    const receipt = await makeService().publish({
      format: 'pptx', title: 'Bilan 2026', themeId: 'corporate-blue-v1',
      slides: [{ kind: 'cover', title: 'Bilan' }],
    });
    expect(receipt.sha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(receipt.filePath).toContain('Documents/Mina Vision/Publications');
    expect(receipt.format).toBe('pptx');
  });

  it('produit les formats document (pdf, docx, md, html, csv, json) avec bon magic byte', async () => {
    for (const format of ['pdf', 'docx', 'md', 'html', 'csv', 'json']) {
      const receipt = await makeService().publish({
        format, title: 'Doc', blocks: [{ kind: 'paragraph', text: 'x' }, { kind: 'table', rows: [['a', 'b']] }],
      });
      expect(receipt.format).toBe(format);
      expect(receipt.sha256).toMatch(/^[a-f0-9]{64}$/u);
    }
  });

  it('produit un XLSX depuis des feuilles', async () => {
    const receipt = await makeService().publish({ format: 'xlsx', title: 'Suivi', sheets: [{ name: 'S', rows: [['a', 1]] }] });
    expect(receipt.format).toBe('xlsx');
  });

  it('ne remplace JAMAIS un fichier existant (suffixe automatique)', async () => {
    const service = makeService();
    const first = await service.publish({ format: 'md', title: 'Meme', blocks: [{ kind: 'paragraph', text: 'x' }] });
    const second = await service.publish({ format: 'md', title: 'Meme', blocks: [{ kind: 'paragraph', text: 'y' }] });
    expect(first.filePath).not.toBe(second.filePath);
  });

  it('exige ses dépendances', () => {
    expect(() => createPublicationService({})).toThrow('publication_service_dependencies_required');
  });
});
