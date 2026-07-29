import { createHash } from 'node:crypto';
import PptxGenJS from 'pptxgenjs';
import { describe, expect, it } from 'vitest';
import { createPublicationService } from '../../src/publication/publication-service.mjs';
import { generatePdf } from '../../src/publication/pdf-generator.mjs';
import { generateDocx } from '../../src/publication/docx-generator.mjs';
import { generateXlsx } from '../../src/publication/xlsx-generator.mjs';
import { generateText } from '../../src/publication/text-generators.mjs';
import { createPresentationGenerator } from '../../src/publication/pptx-generator.mjs';

// Recette d'intégration : le domaine publication produit RÉELLEMENT les huit formats v1, en mode
// « sans IA », sans jamais initialiser ni appeler un fournisseur de modèle (local ou distant).
// providerCalls reste vide par CONSTRUCTION : aucun générateur n'importe de provider ; on le prouve
// en interceptant tout appel réseau (fetch) pendant la génération.

function memFilesystem() {
  const files = new Set();
  return {
    mkdir: async () => {},
    writeFile: async (path) => { files.add(path); },
    rename: async (from, to) => { files.delete(from); files.add(to); },
    access: async (path) => { if (!files.has(path)) throw new Error('enoent'); },
  };
}

function buildService() {
  return createPublicationService({
    generators: {
      pdf: generatePdf, docx: generateDocx, xlsx: generateXlsx, text: generateText,
      pptx: createPresentationGenerator({ pptxFactory: () => new PptxGenJS() }),
    },
    filesystem: memFilesystem(),
    hash: (buffer) => createHash('sha256').update(buffer).digest('hex'),
    baseDir: 'C:/Users/x/Documents/Mina Vision/Publications',
    randomId: () => Math.random().toString(36).slice(2),
    clock: () => new Date(2026, 6, 29, 10, 30, 0),
  });
}

const DOC_BLOCKS = [
  { kind: 'heading', text: 'Résultats 2026 — é € 中文', level: 1 },
  { kind: 'paragraph', text: 'Un paragraphe honnête, entièrement local.' },
  { kind: 'bullets', items: ['Objectif atteint', 'Coût réduit'] },
  { kind: 'table', rows: [['Mois', 'Montant'], ['Janvier', '120'], ['Février', '90']] },
];

async function publishAllFormats() {
  const service = buildService();
  const providerCalls = [];
  const realFetch = globalThis.fetch;
  // Toute tentative réseau pendant la génération = un provider caché → on l'enregistre (doit rester vide).
  globalThis.fetch = (...args) => { providerCalls.push(String(args[0])); throw new Error('network_forbidden_in_without_ai_mode'); };
  try {
    const requests = {
      pdf: { format: 'pdf', title: 'Bilan', blocks: DOC_BLOCKS },
      docx: { format: 'docx', title: 'Bilan', blocks: DOC_BLOCKS },
      pptx: { format: 'pptx', title: 'Bilan', themeId: 'corporate-blue-v1', slides: [{ kind: 'cover', title: 'Bilan 2026' }, { kind: 'bullets', title: 'Points', bullets: ['A', 'B'] }] },
      xlsx: { format: 'xlsx', title: 'Suivi', sheets: [{ name: 'CA', rows: [['Mois', 'CA'], ['Jan', 120]] }] },
      md: { format: 'md', title: 'Bilan', blocks: DOC_BLOCKS },
      html: { format: 'html', title: 'Bilan', blocks: DOC_BLOCKS },
      csv: { format: 'csv', title: 'Bilan', blocks: DOC_BLOCKS },
      json: { format: 'json', title: 'Bilan', blocks: DOC_BLOCKS },
    };
    const order = ['pdf', 'docx', 'pptx', 'xlsx', 'md', 'html', 'csv', 'json'];
    const receipts = [];
    for (const format of order) receipts.push(await service.publish(requests[format]));
    return { formats: receipts.map((entry) => entry.format), providerCalls, receipts };
  } finally {
    globalThis.fetch = realFetch;
  }
}

describe('publication pipeline (intégration, sans IA)', () => {
  it('produit les huit formats v1 sans initialiser ni appeler un fournisseur IA', async () => {
    const result = await publishAllFormats();
    expect(result.formats).toEqual(['pdf', 'docx', 'pptx', 'xlsx', 'md', 'html', 'csv', 'json']);
    expect(result.providerCalls).toEqual([]);
    expect(result.receipts.every((entry) => /^[a-f0-9]{64}$/u.test(entry.sha256))).toBe(true);
    expect(result.receipts.every((entry) => entry.filePath.includes('Documents/Mina Vision/Publications'))).toBe(true);
  });
});
