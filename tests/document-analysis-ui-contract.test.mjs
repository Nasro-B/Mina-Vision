import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const load = (relative) => readFile(new URL(relative, import.meta.url), 'utf8');

describe('panneau d’analyse documentaire', () => {
  it('relie le chemin explicite, le bouton et la synthèse locale au workflow contrôlé', async () => {
    const [html, renderer] = await Promise.all([
      load('../src/ui/index.html'),
      load('../src/ui/renderer.js'),
    ]);

    for (const needle of [
      'id="document-path"',
      'id="document-analyze"',
      'id="document-cancel"',
      'id="document-category"',
      'id="document-project"',
      'id="document-person"',
      'id="document-date"',
      'id="document-classification"',
      'id="document-retention"',
      'id="document-confirm"',
      'id="document-quarantine-refresh"',
      'id="document-quarantine-list"',
      'id="documents-summary"',
    ]) expect(html).toContain(needle);
    for (const needle of [
      "import { bindDocumentAnalysis } from './panels/document-analysis-workflow.mjs';",
      "import { bindDocumentQuarantineList } from './panels/document-quarantine-list-workflow.mjs';",
      "documentPath: document.querySelector('#document-path')",
      "documentAnalyze: document.querySelector('#document-analyze')",
      "documentCancel: document.querySelector('#document-cancel')",
      "documentCategory: document.querySelector('#document-category')",
      "documentProject: document.querySelector('#document-project')",
      "documentPerson: document.querySelector('#document-person')",
      "documentDate: document.querySelector('#document-date')",
      "documentClassification: document.querySelector('#document-classification')",
      "documentRetention: document.querySelector('#document-retention')",
      "documentConfirm: document.querySelector('#document-confirm')",
      "documentQuarantineRefresh: document.querySelector('#document-quarantine-refresh')",
      "documentQuarantineList: document.querySelector('#document-quarantine-list')",
      "documentSummary: document.querySelector('#documents-summary')",
      'bindDocumentAnalysis({',
      'pathInput: elements.documentPath',
      'submitButton: elements.documentAnalyze',
      'cancelButton: elements.documentCancel',
      'categorySelect: elements.documentCategory',
      'overrideInputs: {',
      'project: elements.documentProject',
      'person: elements.documentPerson',
      'date: elements.documentDate',
      'classification: elements.documentClassification',
      'retention: elements.documentRetention',
      'confirmButton: elements.documentConfirm',
      'summary: elements.documentSummary',
      'bindDocumentQuarantineList({',
      'refreshButton: elements.documentQuarantineRefresh',
      'list: elements.documentQuarantineList',
    ]) expect(renderer).toContain(needle);
  });
});
