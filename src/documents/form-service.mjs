import { randomUUID } from 'node:crypto';

const SENSITIVE_FIELDS = new Set(['iban', 'signature', 'ssn', 'password', 'creditCard', 'cardNumber']);

export function createFormService({ evidenceStore, fileWriter, formRenderer = null, capabilityBroker, confirmationService, clock } = {}) {
  if (!evidenceStore?.get) throw new TypeError('form_service_evidence_store_required');
  if (!fileWriter?.writeAtomic) throw new TypeError('form_service_file_writer_required');
  if (!capabilityBroker?.authorize) throw new TypeError('form_service_capability_broker_required');
  if (!confirmationService?.confirm) throw new TypeError('form_service_confirmation_service_required');
  if (!clock || (typeof clock !== 'function' && typeof clock.now !== 'function')) {
    throw new TypeError('form_service_clock_required');
  }
  const now = () => Number(typeof clock === 'function' ? clock() : clock.now());
  const proposals = new Map();

  return Object.freeze({
    async proposeFill({ documentId, values }) {
      const observation = await evidenceStore.get(documentId);
      if (!observation) throw new Error('document_not_parsed');
      const knownFields = new Map((observation.fields ?? []).map((field) => [field.name, field]));

      const diffs = [];
      const unresolvedFields = [];
      for (const [fieldName, proposedValue] of Object.entries(values)) {
        const known = knownFields.get(fieldName);
        if (proposedValue === undefined || proposedValue === null || proposedValue === '') {
          unresolvedFields.push(fieldName);
          continue;
        }
        diffs.push(Object.freeze({
          fieldName,
          oldValue: known?.value ?? null,
          proposedValue,
          sourceRef: known ? `document:${documentId}:${fieldName}` : 'manual',
          confidence: known ? (known.confidence ?? 0.5) : 1,
        }));
      }

      const proposal = Object.freeze({
        id: randomUUID(), documentId, diffs: Object.freeze(diffs), unresolvedFields: Object.freeze(unresolvedFields),
        status: 'proposed', proposedAt: new Date(now()).toISOString(),
      });
      proposals.set(proposal.id, proposal);
      return proposal;
    },

    async renderPreview(proposalId) {
      const proposal = proposals.get(proposalId);
      if (!proposal) throw new Error('form_proposal_not_found');
      return Object.freeze({
        proposalId,
        lines: Object.freeze(proposal.diffs.map((diff) => `${diff.fieldName}: "${diff.oldValue ?? ''}" -> "${diff.proposedValue}" (${diff.sourceRef})`)),
      });
    },

    async commitCopy(proposalId, { destinationPath } = {}) {
      const proposal = proposals.get(proposalId);
      if (!proposal) throw new Error('form_proposal_not_found');
      if (!formRenderer?.render) throw new Error('document_form_rendering_unavailable');

      const sensitive = proposal.diffs.filter((diff) => SENSITIVE_FIELDS.has(diff.fieldName));
      if (sensitive.length > 0) {
        const decision = await capabilityBroker.authorize({ capability: 'documents.form_fill', effect: 'write', resource: proposal.documentId });
        if (decision.decision !== 'allow') throw new Error(decision.reason ?? 'capability_denied');
        const confirmed = await confirmationService.confirm({
          reason: `Remplir des champs sensibles (${sensitive.map((diff) => diff.fieldName).join(', ')}) sur une copie du document.`,
        });
        if (!confirmed) throw new Error('confirmation_refused');
      }

      const path = destinationPath ?? `documents/filled/${proposal.documentId}.${proposal.id}.pdf`;
      const content = await formRenderer.render({
        documentId: proposal.documentId,
        values: Object.freeze(Object.fromEntries(proposal.diffs.map((diff) => [diff.fieldName, diff.proposedValue]))),
        destinationPath: path,
      });
      if (!Buffer.isBuffer(content) && !(content instanceof Uint8Array) && typeof content !== 'string') {
        throw new Error('document_form_rendering_invalid');
      }
      const written = await fileWriter.writeAtomic({ path, content, encoding: 'utf8' });
      proposals.set(proposalId, Object.freeze({ ...proposal, status: 'committed' }));
      return Object.freeze({ proposalId, path, bytes: written?.bytes ?? Buffer.byteLength(content) });
    },
  });
}
