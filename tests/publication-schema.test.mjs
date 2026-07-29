import { describe, expect, it } from 'vitest';
import {
  BLOCK_KINDS, LIMITS, OUTPUT_FORMATS, normalizePublicationBlock, normalizePublicationRequest,
} from '../src/publication/publication-schema.mjs';
import { createPublicationReceipt } from '../src/publication/publication-receipt.mjs';

describe('publication-schema : formats et requête bornée', () => {
  it('expose exactement les 8 formats v1, gelés', () => {
    expect(OUTPUT_FORMATS).toEqual(['pdf', 'docx', 'pptx', 'xlsx', 'md', 'html', 'csv', 'json']);
    expect(Object.isFrozen(OUTPUT_FORMATS)).toBe(true);
    expect(BLOCK_KINDS).toContain('table');
  });

  it('accepte une requête valide et gèle le résultat + ses blocs', () => {
    const req = normalizePublicationRequest({
      title: 'Bilan', format: 'pptx', templateId: 'presentation-corporate-v1',
      blocks: [{ kind: 'title', text: 'Bilan 2026' }], assets: [],
    });
    expect(req.format).toBe('pptx');
    expect(req.title).toBe('Bilan');
    expect(req.author).toBe('Mina Vision');
    expect(req.locale).toBe('fr-FR');
    expect(Object.isFrozen(req)).toBe(true);
    expect(Object.isFrozen(req.blocks)).toBe(true);
  });

  it('refuse un format hors liste', () => {
    expect(() => normalizePublicationRequest({ title: 'x', format: 'exe', blocks: [] }))
      .toThrow('publication_format_invalid');
  });

  it('refuse un titre trop long (> 120)', () => {
    expect(() => normalizePublicationRequest({ title: 'a'.repeat(LIMITS.title + 1), format: 'pdf', blocks: [] }))
      .toThrow('publication_title_too_long');
  });

  it('refuse plus de 100 blocs', () => {
    const blocks = Array.from({ length: LIMITS.blocks + 1 }, () => ({ kind: 'paragraph', text: 'x' }));
    expect(() => normalizePublicationRequest({ title: 'x', format: 'pdf', blocks }))
      .toThrow('publication_blocks_too_many');
  });

  it('refuse un total de texte > 200 000 caractères', () => {
    const blocks = [{ kind: 'paragraph', text: 'a'.repeat(LIMITS.textTotal + 1) }];
    expect(() => normalizePublicationRequest({ title: 'x', format: 'pdf', blocks }))
      .toThrow('publication_text_too_long');
  });

  it('refuse plus de 30 assets', () => {
    const assets = Array.from({ length: LIMITS.assets + 1 }, (_, index) => ({ assetId: `a${index}` }));
    expect(() => normalizePublicationRequest({ title: 'x', format: 'pdf', blocks: [], assets }))
      .toThrow('publication_assets_too_many');
  });

  it('refuse une destination à chemin absolu ou lien distant', () => {
    expect(() => normalizePublicationRequest({ title: 'x', format: 'pdf', blocks: [], destination: 'C:/Windows/x.pdf' }))
      .toThrow('publication_destination_absolute_forbidden');
    expect(() => normalizePublicationRequest({ title: 'x', format: 'pdf', blocks: [], destination: 'https://evil.example/x.pdf' }))
      .toThrow('publication_destination_absolute_forbidden');
    expect(() => normalizePublicationRequest({ title: 'x', format: 'pdf', blocks: [], destination: '/etc/passwd' }))
      .toThrow('publication_destination_absolute_forbidden');
  });

  it('accepte une destination relative', () => {
    expect(normalizePublicationRequest({ title: 'x', format: 'pdf', blocks: [], destination: 'sous-dossier/bilan.pdf' }).destination)
      .toBe('sous-dossier/bilan.pdf');
  });

  it('refuse une clé inattendue au niveau requête', () => {
    expect(() => normalizePublicationRequest({ title: 'x', format: 'pdf', blocks: [], rogue: 1 }))
      .toThrow('publication_unexpected_key');
  });
});

describe('publication-schema : blocs', () => {
  it('valide les kinds autorisés (heading avec niveau, bullets, pageBreak, table)', () => {
    expect(normalizePublicationBlock({ kind: 'heading', text: 'Titre', level: 2 })).toMatchObject({ kind: 'heading', level: 2 });
    expect(normalizePublicationBlock({ kind: 'heading', text: 'x', level: 99 }).level).toBe(6);
    expect(normalizePublicationBlock({ kind: 'bullets', items: ['a', 'b'] }).items).toEqual(['a', 'b']);
    expect(normalizePublicationBlock({ kind: 'pageBreak' })).toEqual({ kind: 'pageBreak' });
    expect(normalizePublicationBlock({ kind: 'table', rows: [['A', 'B'], ['1', '2']] }).rows).toHaveLength(2);
  });

  it('refuse un kind inconnu', () => {
    expect(() => normalizePublicationBlock({ kind: 'video' })).toThrow('publication_block_kind_invalid');
  });

  it('refuse un tableau hors limites (100 lignes × 20 colonnes)', () => {
    const tallRows = Array.from({ length: LIMITS.tableRows + 1 }, () => ['x']);
    expect(() => normalizePublicationBlock({ kind: 'table', rows: tallRows })).toThrow('publication_table_too_large');
    const wideRows = [Array.from({ length: LIMITS.tableCols + 1 }, () => 'x')];
    expect(() => normalizePublicationBlock({ kind: 'table', rows: wideRows })).toThrow('publication_table_too_large');
  });

  it('refuse un texte à schéma exécutable (javascript:) au lieu de le nettoyer en silence', () => {
    expect(() => normalizePublicationBlock({ kind: 'paragraph', text: 'javascript:alert(1)' }))
      .toThrow('publication_text_scheme_forbidden');
    expect(() => normalizePublicationBlock({ kind: 'table', rows: [['data:text/html,<script>']] }))
      .toThrow('publication_text_scheme_forbidden');
  });
});

describe('publication-receipt', () => {
  it('gèle le reçu et exige un sha256 valide', () => {
    const receipt = createPublicationReceipt({
      filePath: 'out/x.pdf', format: 'pdf', bytes: 1234,
      sha256: 'a'.repeat(64), templateId: 'report-v1', assets: [{ assetId: 'a1', provenance: 'user-file' }],
    });
    expect(receipt.sha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(receipt.bytes).toBe(1234);
    expect(Object.isFrozen(receipt)).toBe(true);
    expect(Object.isFrozen(receipt.assets)).toBe(true);
    expect(Object.isFrozen(receipt.assets[0])).toBe(true);
  });

  it('refuse un chemin vide ou un sha256 invalide', () => {
    expect(() => createPublicationReceipt({ filePath: '', format: 'pdf', bytes: 1, sha256: 'a'.repeat(64) }))
      .toThrow('publication_receipt_path_required');
    expect(() => createPublicationReceipt({ filePath: 'x', format: 'pdf', bytes: 1, sha256: 'nope' }))
      .toThrow('publication_receipt_sha256_invalid');
  });
});
