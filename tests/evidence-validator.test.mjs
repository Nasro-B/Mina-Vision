import { describe, expect, it } from 'vitest';
import { createClaimLedger } from '../src/grounding/claim-ledger.mjs';
import { createEvidenceValidator } from '../src/grounding/evidence-validator.mjs';

const NOW = '2026-07-15T00:00:00.000Z';

function setup() {
  let id = 0;
  const ledger = createClaimLedger({
    clock: () => Date.parse(NOW),
    ids: () => `claim-${++id}`,
  });
  const validator = createEvidenceValidator({ clock: () => Date.parse(NOW) });
  return { ledger, validator };
}

function evidence(overrides = {}) {
  return {
    sourceId: 'source-1',
    locator: 'https://example.test/#result',
    capturedAt: NOW,
    contentDigest: 'sha256:abc123',
    freshnessClass: 'stable',
    extract: 'Le bouton est visible.',
    method: 'observed',
    ...overrides,
  };
}

describe('evidence validator', () => {
  it.each([
    {
      expected: 'verified',
      claim: { kind: 'fact', sourceRefs: ['source-1'], status: 'verified' },
      evidence: [evidence()],
    },
    {
      expected: 'inference',
      claim: { kind: 'inference', sourceRefs: ['source-1'], status: 'inference' },
      evidence: [evidence()],
    },
    {
      expected: 'uncertain',
      claim: { kind: 'fact', sourceRefs: ['source-1'], status: 'verified' },
      evidence: [evidence({ method: 'model_inference' })],
    },
    {
      expected: 'not_found',
      claim: { kind: 'absence', sourceRefs: ['source-1'], status: 'not_found' },
      evidence: [evidence({
        method: 'absence_query',
        freshnessClass: 'current',
        scope: 'C:\\Serveurs\\Mina Vision',
        query: 'missing.txt',
        executedAt: NOW,
        result: [],
        exhaustive: true,
      })],
    },
    {
      expected: 'unsupported',
      claim: { kind: 'fact', sourceRefs: [], status: 'verified' },
      evidence: [],
    },
    {
      expected: 'stale',
      claim: { kind: 'current_state', sourceRefs: ['source-1'], status: 'verified' },
      evidence: [evidence({ method: 'document', freshnessClass: 'historical' })],
    },
  ])('returns $expected from deterministic source rules', ({ expected, claim: input, evidence: sources }) => {
    const { ledger, validator } = setup();
    const claim = ledger.add({
      sessionId: 'work-1',
      text: 'Affirmation test',
      ...input,
    });

    expect(validator.validate(claim, sources).status).toBe(expected);
  });

  it('treats model text without a source reference as unsupported', () => {
    const { ledger, validator } = setup();
    const claim = ledger.add({
      sessionId: 'work-1',
      text: 'Le modèle affirme un fait.',
      kind: 'fact',
      sourceRefs: [],
      status: 'verified',
    });

    expect(validator.validate(claim, [evidence({ method: 'model_inference' })])).toMatchObject({
      status: 'unsupported',
      acceptedEvidence: [],
    });
  });

  it('does not use documentation as proof of current state', () => {
    const { ledger, validator } = setup();
    const claim = ledger.add({
      sessionId: 'work-1',
      text: 'Le service est actif.',
      kind: 'current_state',
      sourceRefs: ['source-1'],
      status: 'verified',
    });

    expect(validator.validate(claim, [evidence({ method: 'document' })])).toMatchObject({
      status: 'stale',
      reasons: expect.arrayContaining(['current_state_requires_live_evidence']),
    });
  });

  it('requires a scoped exhaustive empty result to prove absence', () => {
    const { ledger, validator } = setup();
    const claim = ledger.add({
      sessionId: 'work-1',
      text: 'Le fichier est absent.',
      kind: 'absence',
      sourceRefs: ['source-1'],
      status: 'not_found',
    });

    const incomplete = validator.validate(claim, [evidence({ method: 'absence_query', result: [] })]);
    const complete = validator.validate(claim, [evidence({
      method: 'absence_query',
      freshnessClass: 'current',
      scope: 'C:\\Serveurs\\Mina Vision',
      query: 'missing.txt',
      executedAt: NOW,
      result: [],
      exhaustive: true,
    })]);

    expect(incomplete).toMatchObject({ status: 'uncertain' });
    expect(complete).toMatchObject({ status: 'not_found' });
  });

  it('ranks observed evidence above extraction and inference without promoting an inference claim', () => {
    const { ledger, validator } = setup();
    const claim = ledger.add({
      sessionId: 'work-1',
      text: 'La page semble complète.',
      kind: 'inference',
      sourceRefs: ['source-1', 'source-2', 'source-3'],
      status: 'inference',
    });
    const result = validator.validate(claim, [
      evidence({ sourceId: 'source-3', method: 'model_inference' }),
      evidence({ sourceId: 'source-2', method: 'structured_extraction' }),
      evidence({ sourceId: 'source-1', method: 'observed' }),
    ]);

    expect(result.status).toBe('inference');
    expect(result.acceptedEvidence.map((item) => item.method)).toEqual([
      'observed',
      'structured_extraction',
      'model_inference',
    ]);
  });
});
