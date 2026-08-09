import { randomUUID } from 'node:crypto';

const RETENTION_BY_CATEGORY = Object.freeze({
  invoice: 'P10Y',
  contract: 'P10Y',
  identity: 'P99Y',
  other: 'P1Y',
});

function inferCategory(mediaType) {
  if (mediaType === 'application/pdf') return 'other';
  return 'other';
}

export function createDocumentClassifier({ repository, clock } = {}) {
  if (!repository?.put || !repository?.get) throw new TypeError('document_classifier_repository_required');
  if (!clock || (typeof clock !== 'function' && typeof clock.now !== 'function')) {
    throw new TypeError('document_classifier_clock_required');
  }
  const now = () => Number(typeof clock === 'function' ? clock() : clock.now());

  return Object.freeze({
    async proposeClassification(observation, hints = {}) {
      const category = hints.category ?? inferCategory(observation.mediaType);
      const proposal = Object.freeze({
        id: randomUUID(),
        documentId: observation.documentId,
        project: hints.project ?? null,
        category,
        person: hints.person ?? null,
        date: hints.date ?? null,
        classification: hints.classification ?? 'personal',
        retention: RETENTION_BY_CATEGORY[category] ?? RETENTION_BY_CATEGORY.other,
        status: 'proposed',
        proposedAt: new Date(now()).toISOString(),
      });
      await repository.put(proposal.id, proposal);
      return proposal;
    },

    async confirmClassification(proposalId, overrides = {}) {
      const proposal = await repository.get(proposalId);
      if (!proposal) throw new Error('classification_proposal_not_found');
      const category = overrides.category ?? proposal.category;
      const retention = Object.hasOwn(overrides, 'retention')
        ? overrides.retention
        : category === proposal.category
          ? proposal.retention
          : (RETENTION_BY_CATEGORY[category] ?? RETENTION_BY_CATEGORY.other);
      const confirmed = Object.freeze({ ...proposal, ...overrides, category, retention, status: 'confirmed', confirmedAt: new Date(now()).toISOString() });
      await repository.put(proposalId, confirmed);
      return confirmed;
    },

    async getProposal(proposalId) {
      return (await repository.get(proposalId)) ?? null;
    },
  });
}
