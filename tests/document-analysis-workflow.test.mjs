import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { bindDocumentAnalysis } from '../src/ui/panels/document-analysis-workflow.mjs';

function workflowDom() {
  const dom = new JSDOM(`
    <input id="document-path">
    <button id="document-analyze" type="button">Analyser</button>
    <div id="documents-summary"></div>
  `);
  return {
    input: dom.window.document.querySelector('#document-path'),
    button: dom.window.document.querySelector('#document-analyze'),
    summary: dom.window.document.querySelector('#documents-summary'),
  };
}

describe('parcours d’analyse documentaire', () => {
  it('analyse uniquement le chemin choisi et affiche une synthèse sans texte extrait', async () => {
    const { input, button, summary } = workflowDom();
    const api = {
      documentIntake: async (request) => {
        if (JSON.stringify(request) !== JSON.stringify({
          source: 'local_ui', path: 'C:\\Documents\\facture.pdf', declaredName: 'facture.pdf',
        })) throw new Error('document_intake_request_invalid');
        return {
          documentId: 'document-1', status: 'inspectable', detectedType: 'application/pdf', reasons: [],
        };
      },
      documents: {
        parse: async (documentId) => {
          if (documentId !== 'document-1') throw new Error('document_id_invalid');
          return {
            parserId: 'pdf-text-parser', pageCount: 2, confidence: 0.93,
            blockCount: 1,
          };
        },
        proposeClassification: async (documentId) => {
          if (documentId !== 'document-1') throw new Error('document_id_invalid');
          return { category: 'other', retention: 'P1Y' };
        },
      },
    };
    input.value = '  C:\\Documents\\facture.pdf  ';

    const binding = bindDocumentAnalysis({ api, pathInput: input, submitButton: button, summary });
    await expect(binding.run()).resolves.toMatchObject({ state: 'analyzed', documentId: 'document-1' });

    expect(summary.textContent).toContain('PDF');
    expect(summary.textContent).toContain('2 pages');
    expect(summary.textContent).toContain('93 %');
    expect(summary.textContent).toContain('1 bloc');
  });

  it('s’arrête après une quarantaine bloquée sans appeler un parseur', async () => {
    const { input, button, summary } = workflowDom();
    const api = {
      documentIntake: async () => ({
        documentId: 'blocked-1', status: 'blocked', detectedType: 'application/x-executable', reasons: ['executable'],
      }),
      documents: {
        parse: async () => { throw new Error('parser_must_not_run'); },
        proposeClassification: async () => { throw new Error('classifier_must_not_run'); },
      },
    };
    input.value = 'C:\\Documents\\facture.pdf';

    const binding = bindDocumentAnalysis({ api, pathInput: input, submitButton: button, summary });
    await expect(binding.run()).resolves.toMatchObject({ state: 'blocked', documentId: 'blocked-1' });

    expect(summary.textContent).toContain('Fichier bloqué');
    expect(summary.textContent).toContain('executable');
  });

  it('refuse un chemin vide sans appeler la couche IPC', async () => {
    const { input, button, summary } = workflowDom();
    const api = {
      documentIntake: async () => { throw new Error('intake_must_not_run'); },
      documents: {},
    };
    input.value = '   ';

    const binding = bindDocumentAnalysis({ api, pathInput: input, submitButton: button, summary });
    await expect(binding.run()).rejects.toThrow('document_path_required');
    expect(summary.textContent).toContain('Indiquez le chemin');
  });
});
