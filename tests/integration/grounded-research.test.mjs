import { describe, expect, it } from 'vitest';
import { createClaimLedger } from '../../src/grounding/claim-ledger.mjs';
import { gateResponse } from '../../src/grounding/response-gate.mjs';
import { sanitizePublicUrl, redactSensitiveText } from '../../src/research/network-evidence.mjs';

function fixtureEvidence({ sourceId, locator, extract, capturedAt }) {
  return Object.freeze({
    sourceId, locator, capturedAt, contentDigest: `sha256:${'a'.repeat(64)}`, freshnessClass: 'current', extract, method: 'structured_extraction',
  });
}

describe('v2 integration: two research sources disagree on the same fact — grounding surfaces the contradiction, never picks a side silently', () => {
  it('produces a "revise" decision (not a confident answer) when two verified claims conflict on the same fact key', () => {
    const claimLedger = createClaimLedger({ clock: () => Date.parse('2026-07-16T09:00:00.000Z'), ids: () => `claim-${Math.random().toString(36).slice(2)}` });

    const evidenceA = fixtureEvidence({
      sourceId: 'source-boulangerie-officiel', locator: 'https://boulangerie-du-coin.example/horaires',
      extract: 'Fermeture à 19h30 du lundi au samedi.', capturedAt: '2026-07-10T08:00:00.000Z',
    });
    const evidenceB = fixtureEvidence({
      sourceId: 'source-annuaire-local', locator: 'https://annuaire-local.example/boulangerie-du-coin',
      extract: 'Horaires : fermeture 18h00.', capturedAt: '2026-06-01T08:00:00.000Z',
    });

    const claimA = claimLedger.add({
      sessionId: 'session-1', text: 'La boulangerie ferme à 19h30.', kind: 'fact', sourceRefs: [evidenceA.sourceId], status: 'verified',
      fact: { key: 'closing_time_boulangerie_du_coin', value: '19:30', polarity: 'present', observedAt: evidenceA.capturedAt },
    });
    const claimB = claimLedger.add({
      sessionId: 'session-1', text: 'La boulangerie ferme à 18h00.', kind: 'fact', sourceRefs: [evidenceB.sourceId], status: 'verified',
      fact: { key: 'closing_time_boulangerie_du_coin', value: '18:00', polarity: 'present', observedAt: evidenceB.capturedAt },
    });

    const draft = { segments: [{ kind: 'factual', claimId: claimA.claimId, text: claimA.text }] };
    const citations = [{ claimId: claimA.claimId, evidenceId: evidenceA.sourceId }];
    const result = gateResponse({ draft, claims: [claimA, claimB], citations });

    expect(result.decision).toBe('revise');
    expect(result.issues.some((issue) => issue.startsWith('contradiction:closing_time_boulangerie_du_coin'))).toBe(true);
  });

  it('the more recently observed source is the one grounding would prefer, per the real contradiction-detector rule', async () => {
    const { detectContradictions } = await import('../../src/grounding/contradiction-detector.mjs');
    const older = { claimId: 'claim-old', fact: { key: 'k', value: 'A', polarity: 'present', observedAt: '2026-06-01T00:00:00.000Z' } };
    const newer = { claimId: 'claim-new', fact: { key: 'k', value: 'B', polarity: 'present', observedAt: '2026-07-10T00:00:00.000Z' } };
    const [contradiction] = detectContradictions([older, newer]);
    expect(contradiction.preferredClaimId).toBe('claim-new');
    expect(contradiction.reason).toBe('newer_observation');
  });

  it('two sources that fully agree on a fact never trigger a contradiction, and the response is allowed', () => {
    const claimLedger = createClaimLedger({ clock: () => Date.parse('2026-07-16T09:00:00.000Z'), ids: () => `claim-${Math.random().toString(36).slice(2)}` });
    const evidenceA = fixtureEvidence({ sourceId: 'source-1', locator: 'https://a.example', extract: 'Ouvert 9h-18h.', capturedAt: '2026-07-10T08:00:00.000Z' });
    const claimA = claimLedger.add({
      sessionId: 's', text: 'Ouvert de 9h à 18h.', kind: 'fact', sourceRefs: [evidenceA.sourceId], status: 'verified',
      fact: { key: 'hours', value: '9-18', polarity: 'present', observedAt: evidenceA.capturedAt },
    });
    const claimB = claimLedger.add({
      sessionId: 's', text: 'Ouvert de 9h à 18h (confirmé).', kind: 'fact', sourceRefs: [evidenceA.sourceId], status: 'verified',
      fact: { key: 'hours', value: '9-18', polarity: 'present', observedAt: evidenceA.capturedAt },
    });

    const draft = { segments: [{ kind: 'factual', claimId: claimA.claimId, text: claimA.text }] };
    const result = gateResponse({ draft, claims: [claimA, claimB], citations: [{ claimId: claimA.claimId, evidenceId: evidenceA.sourceId }] });
    expect(result.decision).toBe('allow');
  });

  it('network-evidence redaction (reused by web-reader) never leaves a token/secret/password in an extracted body', () => {
    const raw = '<a href="/x" data-token="abc123" data-secret="shh">Lien</a>';
    expect(redactSensitiveText(raw)).not.toContain('abc123');
    expect(sanitizePublicUrl('https://user:pass@example.com/path?token=abc')).not.toContain('pass');
  });
});
