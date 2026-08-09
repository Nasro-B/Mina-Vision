import { describe, expect, it, vi } from 'vitest';
import { createClaimLedger } from '../src/grounding/claim-ledger.mjs';
import { createEvidenceValidator } from '../src/grounding/evidence-validator.mjs';
import { createGroundingPipeline } from '../src/grounding/grounding-pipeline.mjs';
import { createGroundedResponseService } from '../src/grounding/grounded-response.mjs';

const SAFE_RESPONSE = 'Je ne peux pas fournir une réponse factuelle vérifiée avec les preuves disponibles.';

function createService() {
  const claimLedger = createClaimLedger({
    clock: () => Date.parse('2026-08-09T08:55:00.000Z'),
    ids: (() => { let index = 0; return () => `claim-${++index}`; })(),
  });
  const evidenceValidator = createEvidenceValidator({ clock: () => Date.parse('2026-08-09T08:55:00.000Z') });
  return createGroundedResponseService({
    pipeline: createGroundingPipeline({ claimLedger, evidenceValidator }),
  });
}

const evidence = Object.freeze([Object.freeze({
  sourceId: 'evidence-1',
  locator: 'tool://controlled-fixture',
  capturedAt: '2026-08-09T08:54:00.000Z',
  contentDigest: 'sha256:fixture',
  freshnessClass: 'current',
  extract: 'Le résultat contrôlé est X. token = "secret-de-test"',
  method: 'tool_output',
})]);

const baseRequest = Object.freeze({
  messages: Object.freeze([{ role: 'user', content: 'Quel est le résultat contrôlé ?' }]),
  evidence,
  workSessionId: 'work-1',
  channel: 'telegram',
  maxOutput: 4_096,
});

describe('grounded response service', () => {
  it('returns a locally identified cited fact when the referenced evidence validates it', async () => {
    const generate = vi.fn(async () => ({ output: JSON.stringify({
      segments: [{ kind: 'factual', text: 'La source indique X.', claimType: 'fact', sourceRefs: ['evidence-1'] }],
      citations: [{ segmentIndex: 0, evidenceId: 'evidence-1' }],
    }) }));

    const result = await createService().reply({ ...baseRequest, generate });

    expect(result).toMatchObject({
      decision: 'allow',
      text: 'La source indique X.',
      citations: [{ claimId: expect.any(String), evidenceId: 'evidence-1' }],
    });
    expect(result.claims).toEqual([expect.objectContaining({ claimId: 'claim-1', status: 'verified' })]);
    const modelMessages = generate.mock.calls[0][0].messages;
    expect(modelMessages.some((message) => message.content.includes('[evidence-1]'))).toBe(true);
    expect(modelMessages.some((message) => message.content.includes('[REDACTED]'))).toBe(true);
    expect(modelMessages.some((message) => message.content.includes('secret-de-test'))).toBe(false);
  });

  it('allows a creative-only envelope without inventing a claim', async () => {
    const generate = vi.fn(async () => ({ output: JSON.stringify({
      segments: [{ kind: 'creative', text: 'Bonjour Nasro.' }],
      citations: [],
    }) }));

    const result = await createService().reply({ ...baseRequest, evidence: [], generate });

    expect(result).toEqual(expect.objectContaining({
      decision: 'allow', text: 'Bonjour Nasro.', claims: [], citations: [],
    }));
  });

  it('returns the fixed safe reply for an unsupported factual claim', async () => {
    const generate = vi.fn(async () => ({ output: JSON.stringify({
      segments: [{ kind: 'factual', text: 'Une affirmation sans preuve.', claimType: 'fact', sourceRefs: [] }],
      citations: [],
    }) }));

    const result = await createService().reply({ ...baseRequest, evidence: [], generate });

    expect(result).toEqual(expect.objectContaining({ decision: 'revise', text: SAFE_RESPONSE }));
    expect(result.text).not.toContain('Une affirmation sans preuve.');
  });

  it('returns the fixed safe reply instead of raw non-JSON provider text', async () => {
    const generate = vi.fn(async () => ({ output: 'Le fournisseur dit que tout est terminé.' }));

    const result = await createService().reply({ ...baseRequest, generate });

    expect(result).toEqual(expect.objectContaining({ decision: 'block', text: SAFE_RESPONSE }));
    expect(result.text).not.toContain('Le fournisseur dit que tout est terminé.');
  });

  it('propagates a provider failure so the delivery ledger can retry instead of sending a fallback', async () => {
    const generate = vi.fn(async () => { throw new Error('ETIMEDOUT'); });

    await expect(createService().reply({ ...baseRequest, generate })).rejects.toThrow('ETIMEDOUT');
  });

  it('returns the fixed safe reply when rendered text exceeds the caller bound', async () => {
    const generate = vi.fn(async () => ({ output: JSON.stringify({
      segments: [{ kind: 'creative', text: 'x'.repeat(101) }],
      citations: [],
    }) }));

    const result = await createService().reply({ ...baseRequest, maxOutput: 100, generate });

    expect(result).toEqual(expect.objectContaining({ decision: 'block', text: SAFE_RESPONSE }));
  });
});
