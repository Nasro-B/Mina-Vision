import { describe, expect, it } from 'vitest';
import { createClaimLedger } from '../src/grounding/claim-ledger.mjs';
import { createEvidenceValidator } from '../src/grounding/evidence-validator.mjs';
import { createGroundingPipeline } from '../src/grounding/grounding-pipeline.mjs';

const NOW = Date.parse('2026-07-29T10:00:00.000Z');

function createPipeline() {
  let id = 0;
  const claimLedger = createClaimLedger({
    clock: () => NOW,
    ids: () => `claim-${++id}`,
  });
  const evidenceValidator = createEvidenceValidator({ clock: () => NOW });
  return { claimLedger, pipeline: createGroundingPipeline({ claimLedger, evidenceValidator }) };
}

function adbEvidence() {
  return {
    sourceId: 'adb-1',
    locator: 'adb devices',
    capturedAt: '2026-07-29T10:00:00.000Z',
    contentDigest: 'a',
    extract: 'device',
    freshnessClass: 'current',
    method: 'tool_output',
  };
}

describe('grounding pipeline', () => {
  it('records the exact structured envelope and derives verified only from matching evidence', () => {
    const { claimLedger, pipeline } = createPipeline();

    const result = pipeline.recordAndValidate({
      workSessionId: 'work-1',
      claims: [{
        text: 'ADB est connecté.',
        kind: 'current_state',
        sourceRefs: ['adb-1'],
        status: 'verified',
      }],
      evidence: [adbEvidence()],
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      claimId: 'claim-1',
      sessionId: 'work-1',
      status: 'verified',
      evidenceIds: ['adb-1'],
    });
    expect(claimLedger.get('claim-1')).toBe(result[0]);
  });

  it('does not allow a caller to declare an unsupported claim verified', () => {
    const { pipeline } = createPipeline();

    const [claim] = pipeline.recordAndValidate({
      workSessionId: 'work-1',
      claims: [{
        text: 'ADB est connecté.',
        kind: 'current_state',
        sourceRefs: ['adb-1'],
        status: 'verified',
      }],
      evidence: [],
    });

    expect(claim.status).toBe('unsupported');
  });

  it('revises a factual segment without citation but leaves a pure social segment available', () => {
    const { pipeline } = createPipeline();
    const claims = pipeline.recordAndValidate({
      workSessionId: 'work-1',
      claims: [{ text: 'ADB est connecté.', kind: 'current_state', sourceRefs: ['adb-1'] }],
      evidence: [adbEvidence()],
    });

    expect(pipeline.gate({
      draft: { segments: [{ kind: 'factual', text: 'ADB est connecté.', claimId: claims[0].claimId }] },
      claims,
      citations: [],
    })).toMatchObject({ decision: 'revise', issues: [`missing_citation:${claims[0].claimId}`] });

    expect(pipeline.gate({
      draft: { segments: [{ kind: 'social', text: 'Bonjour.' }] },
      claims: [],
      citations: [],
    })).toEqual({ decision: 'allow', response: { text: 'Bonjour.', citations: [] } });
  });
});
