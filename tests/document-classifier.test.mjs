import { describe, expect, it } from 'vitest';
import { createDocumentClassifier } from '../src/documents/document-classifier.mjs';

function fakeRepository() {
  const rows = new Map();
  return {
    async put(id, record) { rows.set(id, record); },
    async get(id) { return rows.get(id) ?? null; },
  };
}

const observation = Object.freeze({ documentId: 'd1', mediaType: 'application/pdf' });

describe('createDocumentClassifier: constructor guards', () => {
  it('requires a repository', () => {
    expect(() => createDocumentClassifier({ clock: () => 0 })).toThrow('document_classifier_repository_required');
  });
});

describe('createDocumentClassifier.proposeClassification', () => {
  it('stores project/category/person/date/classification/retention as a proposal', async () => {
    const classifier = createDocumentClassifier({ repository: fakeRepository(), clock: () => 1_700_000_000_000 });
    const proposal = await classifier.proposeClassification(observation, { project: 'Impôts 2026', person: 'Nasro', date: '2026-07-01' });
    expect(proposal).toMatchObject({
      documentId: 'd1', project: 'Impôts 2026', person: 'Nasro', date: '2026-07-01', status: 'proposed',
    });
    expect(typeof proposal.classification).toBe('string');
    expect(typeof proposal.retention).toBe('string');
  });

  it('defaults project/person/date to null when no hints are given', async () => {
    const classifier = createDocumentClassifier({ repository: fakeRepository(), clock: () => 0 });
    const proposal = await classifier.proposeClassification(observation);
    expect(proposal.project).toBeNull();
    expect(proposal.person).toBeNull();
  });
});

describe('createDocumentClassifier.confirmClassification', () => {
  it('confirms a proposal, merging any overrides', async () => {
    const classifier = createDocumentClassifier({ repository: fakeRepository(), clock: () => 0 });
    const proposal = await classifier.proposeClassification(observation);
    const confirmed = await classifier.confirmClassification(proposal.id, { project: 'Impôts 2026' });
    expect(confirmed).toMatchObject({ status: 'confirmed', project: 'Impôts 2026' });
  });

  it('recalculates retention when confirmation changes category', async () => {
    const classifier = createDocumentClassifier({ repository: fakeRepository(), clock: () => 0 });
    const proposal = await classifier.proposeClassification(observation);
    const confirmed = await classifier.confirmClassification(proposal.id, { category: 'invoice' });
    expect(confirmed).toMatchObject({ category: 'invoice', retention: 'P10Y', status: 'confirmed' });
  });

  it('rejects confirming an unknown proposal', async () => {
    const classifier = createDocumentClassifier({ repository: fakeRepository(), clock: () => 0 });
    await expect(classifier.confirmClassification('missing')).rejects.toThrow('classification_proposal_not_found');
  });
});

describe('createDocumentClassifier.getProposal', () => {
  it('returns null for an unknown proposal', async () => {
    const classifier = createDocumentClassifier({ repository: fakeRepository(), clock: () => 0 });
    expect(await classifier.getProposal('missing')).toBeNull();
  });
});
