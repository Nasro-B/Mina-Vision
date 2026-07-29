import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createFormService } from '../src/documents/form-service.mjs';

function digestOf(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function fakeEvidenceStore(observation) {
  return { get: vi.fn(async (documentId) => (documentId === observation.documentId ? observation : null)) };
}

function fakeFileWriter() {
  const writes = [];
  return { writes, writeAtomic: vi.fn(async ({ path, content }) => { writes.push({ path, content }); return { bytes: Buffer.byteLength(String(content)) }; }) };
}

const observation = Object.freeze({
  documentId: 'd1',
  fields: [{ name: 'name', value: 'Nasro', confidence: 0.9 }, { name: 'iban', value: null, confidence: 0 }],
});

function buildWorld(overrides = {}) {
  const evidenceStore = fakeEvidenceStore(observation);
  const fileWriter = fakeFileWriter();
  const capabilityBroker = { authorize: vi.fn(async () => ({ decision: 'allow', reason: 'ok' })) };
  const confirmationService = { confirm: vi.fn(async () => true) };
  const formRenderer = { render: vi.fn(async () => Buffer.from('filled-pdf-bytes')) };
  const forms = createFormService({ evidenceStore, fileWriter, formRenderer, capabilityBroker, confirmationService, clock: () => 1_700_000_000_000, ...overrides });
  return { forms, evidenceStore, fileWriter, formRenderer, capabilityBroker, confirmationService };
}

describe('createFormService: constructor guards', () => {
  it('requires an evidence store', () => {
    expect(() => createFormService({})).toThrow('form_service_evidence_store_required');
  });
});

describe('createFormService.proposeFill: never invents a value, tracks unresolved fields', () => {
  it('reports an undefined value as unresolved rather than a fabricated diff', async () => {
    const { forms } = buildWorld();
    const proposal = await forms.proposeFill({ documentId: 'd1', values: { iban: undefined } });
    expect(proposal.unresolvedFields).toContain('iban');
    expect(proposal.diffs).toEqual([]);
  });

  it('builds a sourced diff for a resolvable field, with oldValue/proposedValue/sourceRef/confidence', async () => {
    const { forms } = buildWorld();
    const proposal = await forms.proposeFill({ documentId: 'd1', values: { name: 'Nasro Berkoun' } });
    expect(proposal.diffs[0]).toMatchObject({ fieldName: 'name', oldValue: 'Nasro', proposedValue: 'Nasro Berkoun', sourceRef: 'document:d1:name', confidence: 0.9 });
  });

  it('marks a manually supplied value (unknown to the document) with sourceRef manual and full confidence', async () => {
    const { forms } = buildWorld();
    const proposal = await forms.proposeFill({ documentId: 'd1', values: { comment: 'note libre' } });
    expect(proposal.diffs[0]).toMatchObject({ sourceRef: 'manual', confidence: 1 });
  });

  it('rejects proposing a fill for a document never parsed', async () => {
    const { forms } = buildWorld();
    await expect(forms.proposeFill({ documentId: 'missing', values: {} })).rejects.toThrow('document_not_parsed');
  });
});

describe('createFormService.commitCopy: original integrity, sensitive-field confirmation', () => {
  it('refuses to describe a JSON copy as a filled document when no form renderer is composed', async () => {
    const { forms, fileWriter } = buildWorld({ formRenderer: null });
    const proposal = await forms.proposeFill({ documentId: 'd1', values: { name: 'Nasro Berkoun' } });

    await expect(forms.commitCopy(proposal.id)).rejects.toThrow('document_form_rendering_unavailable');
    expect(fileWriter.writeAtomic).not.toHaveBeenCalled();
  });

  it('never overwrites or touches the original document path', async () => {
    const { forms, fileWriter } = buildWorld();
    const originalBytes = Buffer.from('original pdf bytes');
    const originalDigest = digestOf(originalBytes);
    const proposal = await forms.proposeFill({ documentId: 'd1', values: { iban: undefined } });
    await forms.commitCopy(proposal.id);
    expect(fileWriter.writes.every((write) => write.path !== 'originals/d1.pdf')).toBe(true);
    expect(digestOf(originalBytes)).toBe(originalDigest);
  });

  it('writes the committed copy to a new destination, never the source', async () => {
    const { forms, fileWriter } = buildWorld();
    const proposal = await forms.proposeFill({ documentId: 'd1', values: { name: 'Nasro Berkoun' } });
    const result = await forms.commitCopy(proposal.id);
    expect(result.path).not.toBe('originals/d1.pdf');
    expect(fileWriter.writeAtomic).toHaveBeenCalledTimes(1);
  });

  it('requires local confirmation before committing a sensitive field like iban', async () => {
    const confirmationService = { confirm: vi.fn(async () => true) };
    const { forms } = buildWorld({ confirmationService });
    const proposal = await forms.proposeFill({ documentId: 'd1', values: { iban: 'FR7630006000011234567890189' } });
    await forms.commitCopy(proposal.id);
    expect(confirmationService.confirm).toHaveBeenCalledTimes(1);
  });

  it('never commits a sensitive field when confirmation is refused', async () => {
    const confirmationService = { confirm: vi.fn(async () => false) };
    const { forms, fileWriter } = buildWorld({ confirmationService });
    const proposal = await forms.proposeFill({ documentId: 'd1', values: { iban: 'FR7630006000011234567890189' } });
    await expect(forms.commitCopy(proposal.id)).rejects.toThrow('confirmation_refused');
    expect(fileWriter.writeAtomic).not.toHaveBeenCalled();
  });

  it('does not require confirmation for a proposal with no sensitive fields', async () => {
    const confirmationService = { confirm: vi.fn(async () => true) };
    const { forms } = buildWorld({ confirmationService });
    const proposal = await forms.proposeFill({ documentId: 'd1', values: { name: 'Nasro Berkoun' } });
    await forms.commitCopy(proposal.id);
    expect(confirmationService.confirm).not.toHaveBeenCalled();
  });

  it('rejects committing an unknown proposal', async () => {
    const { forms } = buildWorld();
    await expect(forms.commitCopy('missing')).rejects.toThrow('form_proposal_not_found');
  });
});

describe('createFormService.renderPreview', () => {
  it('renders a human-readable preview of each diff', async () => {
    const { forms } = buildWorld();
    const proposal = await forms.proposeFill({ documentId: 'd1', values: { name: 'Nasro Berkoun' } });
    const preview = await forms.renderPreview(proposal.id);
    expect(preview.lines[0]).toContain('name');
    expect(preview.lines[0]).toContain('Nasro Berkoun');
  });

  it('rejects previewing an unknown proposal', async () => {
    const { forms } = buildWorld();
    await expect(forms.renderPreview('missing')).rejects.toThrow('form_proposal_not_found');
  });
});
