import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { bindDocumentAnalysis } from '../src/ui/panels/document-analysis-workflow.mjs';

function workflowDom() {
  const dom = new JSDOM(`
    <input id="document-path">
    <button id="document-analyze" type="button">Analyser</button>
    <button id="document-cancel" type="button" hidden disabled>Annuler</button>
    <select id="document-category"><option value="other">Autre</option><option value="invoice">Facture</option></select>
    <input id="document-project">
    <input id="document-person">
    <input id="document-date">
    <select id="document-classification"><option value="personal">Personnel</option><option value="sensitive">Sensible</option></select>
    <input id="document-retention">
    <button id="document-confirm" type="button" disabled>Confirmer</button>
    <div id="documents-summary"></div>
  `);
  return {
    input: dom.window.document.querySelector('#document-path'),
    button: dom.window.document.querySelector('#document-analyze'),
    cancel: dom.window.document.querySelector('#document-cancel'),
    category: dom.window.document.querySelector('#document-category'),
    project: dom.window.document.querySelector('#document-project'),
    person: dom.window.document.querySelector('#document-person'),
    date: dom.window.document.querySelector('#document-date'),
    classification: dom.window.document.querySelector('#document-classification'),
    retention: dom.window.document.querySelector('#document-retention'),
    confirm: dom.window.document.querySelector('#document-confirm'),
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
        evidence: async (documentId) => {
          if (documentId !== 'document-1') throw new Error('document_id_invalid');
          return {
            parserId: 'pdf-text-parser', totalBlocks: 1, truncated: false,
            evidence: [{ blockIndex: 0, locator: { kind: 'pdf_text', page: 2, start: 0, end: 12 }, confidence: 0.93, text: 'Donnée personnelle' }],
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
    expect(summary.textContent).toContain('Preuves locales');
    expect(summary.textContent).toContain('page 2');
    expect(summary.textContent).not.toContain('Donnée personnelle');
  });

  it('s’arrête après une quarantaine bloquée sans appeler un parseur', async () => {
    const { input, button, summary } = workflowDom();
    const api = {
      documentIntake: async () => ({
        documentId: 'blocked-1', status: 'blocked', detectedType: 'application/x-executable', reasons: ['executable'],
      }),
      documents: {
        parse: async () => { throw new Error('parser_must_not_run'); },
        evidence: async () => { throw new Error('evidence_must_not_run'); },
        proposeClassification: async () => { throw new Error('classifier_must_not_run'); },
      },
    };
    input.value = 'C:\\Documents\\facture.pdf';

    const binding = bindDocumentAnalysis({ api, pathInput: input, submitButton: button, summary });
    await expect(binding.run()).resolves.toMatchObject({ state: 'blocked', documentId: 'blocked-1' });

    expect(summary.textContent).toContain('Fichier bloqué');
    expect(summary.textContent).toContain('executable');
  });

  it('attend un choix explicite avant de confirmer le classement proposé', async () => {
    const { input, button, category, confirm, summary } = workflowDom();
    const api = {
      documentIntake: async () => ({
        documentId: 'document-1', status: 'inspectable', detectedType: 'application/pdf', reasons: [],
      }),
      documents: {
        parse: async () => ({ parserId: 'pdf-text-parser', pageCount: 1, blockCount: 1, confidence: 1 }),
        evidence: async () => ({ parserId: 'pdf-text-parser', totalBlocks: 1, truncated: false, evidence: [] }),
        proposeClassification: async () => ({ id: 'proposal-1', category: 'other', retention: 'P1Y' }),
        confirmClassification: async (proposalId, overrides) => {
          if (proposalId !== 'proposal-1' || JSON.stringify(overrides) !== JSON.stringify({ category: 'invoice' })) {
            throw new Error('classification_confirmation_invalid');
          }
          return { category: 'invoice', retention: 'P10Y', status: 'confirmed' };
        },
      },
    };
    input.value = 'C:\\Documents\\facture.pdf';

    const binding = bindDocumentAnalysis({
      api, pathInput: input, submitButton: button, summary, categorySelect: category, confirmButton: confirm,
    });
    await binding.run();
    expect(confirm.disabled).toBe(false);

    category.value = 'invoice';
    await expect(binding.confirm()).resolves.toMatchObject({ status: 'confirmed', category: 'invoice' });
    expect(summary.textContent).toContain('Classement confirmé');
    expect(summary.textContent).toContain('invoice');
    expect(confirm.disabled).toBe(true);
  });

  it('transmet les corrections explicites de métadonnées lors de la confirmation', async () => {
    const { input, button, category, project, person, date, classification, retention, confirm, summary } = workflowDom();
    const expectedOverrides = {
      category: 'invoice',
      project: 'Impôts 2026',
      person: 'Nasro',
      date: '2026-08-20',
      classification: 'sensitive',
      retention: 'P2Y',
    };
    const api = {
      documentIntake: async () => ({
        documentId: 'document-1', status: 'inspectable', detectedType: 'application/pdf', reasons: [],
      }),
      documents: {
        parse: async () => ({ parserId: 'pdf-text-parser', pageCount: 1, blockCount: 1, confidence: 1 }),
        evidence: async () => ({ parserId: 'pdf-text-parser', totalBlocks: 1, truncated: false, evidence: [] }),
        proposeClassification: async () => ({
          id: 'proposal-1', category: 'other', classification: 'personal', retention: 'P1Y',
        }),
        confirmClassification: async (proposalId, overrides) => {
          expect(proposalId).toBe('proposal-1');
          expect(overrides).toEqual(expectedOverrides);
          return { ...expectedOverrides, status: 'confirmed' };
        },
      },
    };
    input.value = 'C:\\Documents\\facture.pdf';

    const binding = bindDocumentAnalysis({
      api,
      pathInput: input,
      submitButton: button,
      summary,
      categorySelect: category,
      overrideInputs: { project, person, date, classification, retention },
      confirmButton: confirm,
    });
    await binding.run();

    category.value = 'invoice';
    project.value = '  Impôts 2026  ';
    person.value = 'Nasro';
    date.value = '2026-08-20';
    classification.value = 'sensitive';
    retention.value = 'P2Y';

    await expect(binding.confirm()).resolves.toMatchObject({ status: 'confirmed', retention: 'P2Y' });
    expect(summary.textContent).toContain('Classement confirmé');
    expect(summary.textContent).toContain('P2Y');
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

  it('annule un parsing actif puis n’affiche aucun classement', async () => {
    const { input, button, cancel, summary } = workflowDom();
    let rejectParse;
    let startParse;
    const parseStarted = new Promise((resolve) => { startParse = resolve; });
    const api = {
      documentIntake: async () => ({
        documentId: 'document-1', status: 'inspectable', detectedType: 'application/pdf', reasons: [],
      }),
      documents: {
        parse: () => new Promise((_resolve, reject) => {
          rejectParse = reject;
          startParse();
        }),
        cancel: async (documentId) => {
          if (documentId !== 'document-1') throw new Error('document_id_invalid');
          rejectParse(new Error('document_parse_cancelled'));
          return { documentId, cancelled: true };
        },
        evidence: async () => { throw new Error('evidence_must_not_run'); },
        proposeClassification: async () => { throw new Error('classifier_must_not_run'); },
      },
    };
    input.value = 'C:\\Documents\\facture.pdf';
    const binding = bindDocumentAnalysis({ api, pathInput: input, submitButton: button, cancelButton: cancel, summary });

    const pending = binding.run();
    await parseStarted;
    expect(cancel.hidden).toBe(false);
    expect(cancel.disabled).toBe(false);

    await expect(binding.cancel()).resolves.toEqual({ documentId: 'document-1', cancelled: true });
    await expect(pending).rejects.toThrow('document_parse_cancelled');
    expect(summary.textContent).toContain('Analyse annulée');
    expect(summary.textContent).not.toContain('Classement proposé');
    expect(cancel.hidden).toBe(true);
    expect(cancel.disabled).toBe(true);
  });

  it('retire l’annulation dès que le parsing est terminé', async () => {
    const { input, button, cancel, summary } = workflowDom();
    let resolveEvidence;
    let signalEvidenceStarted;
    const evidenceStarted = new Promise((resolve) => { signalEvidenceStarted = resolve; });
    const api = {
      documentIntake: async () => ({
        documentId: 'document-1', status: 'inspectable', detectedType: 'application/pdf', reasons: [],
      }),
      documents: {
        parse: async () => ({ parserId: 'pdf-text-parser', pageCount: 1, blockCount: 1, confidence: 1 }),
        cancel: async () => ({ documentId: 'document-1', cancelled: false }),
        evidence: () => {
          signalEvidenceStarted();
          return new Promise((resolve) => { resolveEvidence = resolve; });
        },
        proposeClassification: async () => ({ category: 'other', retention: 'P1Y' }),
      },
    };
    input.value = 'C:\\Documents\\facture.pdf';
    const binding = bindDocumentAnalysis({ api, pathInput: input, submitButton: button, cancelButton: cancel, summary });

    const pending = binding.run();
    await evidenceStarted;
    expect(cancel.hidden).toBe(true);
    expect(cancel.disabled).toBe(true);
    await expect(binding.cancel()).rejects.toThrow('document_parse_cancellation_unavailable');

    resolveEvidence({ parserId: 'pdf-text-parser', totalBlocks: 0, truncated: false, evidence: [] });
    await expect(pending).resolves.toMatchObject({ state: 'analyzed', documentId: 'document-1' });
  });
});
