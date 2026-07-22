import { describe, expect, it } from 'vitest';
import { createClaimLedger } from '../src/grounding/claim-ledger.mjs';
import { detectContradictions } from '../src/grounding/contradiction-detector.mjs';
import { gateResponse } from '../src/grounding/response-gate.mjs';

const BASE_TIME = Date.parse('2026-07-15T00:00:00.000Z');

function createLedger() {
  let id = 0;
  return createClaimLedger({
    clock: () => BASE_TIME,
    ids: () => `claim-${++id}`,
  });
}

function addFact(ledger, {
  key = 'service.api.status',
  value = 'up',
  polarity = 'present',
  observedAt = '2026-07-15T00:00:00.000Z',
  status = 'verified',
  kind = 'current_state',
  sourceRefs = ['evidence-1'],
  text = 'Le service est actif.',
} = {}) {
  return ledger.add({
    sessionId: 'work-1',
    text,
    kind,
    sourceRefs,
    status,
    fact: { key, value, observedAt, polarity },
  });
}

describe('contradiction detector', () => {
  it('detects incompatible values for the same factual key', () => {
    const ledger = createLedger();
    const active = addFact(ledger, { value: 'up' });
    const inactive = addFact(ledger, { value: 'down', sourceRefs: ['evidence-2'] });

    expect(detectContradictions([active, inactive])).toEqual([{
      key: 'service.api.status',
      type: 'incompatible_values',
      claimIds: ['claim-1', 'claim-2'],
      preferredClaimId: null,
      reason: 'same_observation_time',
    }]);
  });

  it('prefers the uniquely newer observation without hiding the conflict', () => {
    const ledger = createLedger();
    const older = addFact(ledger, { observedAt: '2026-07-15T00:00:00.000Z', value: 'up' });
    const newer = addFact(ledger, {
      observedAt: '2026-07-15T00:01:00.000Z',
      value: 'down',
      sourceRefs: ['evidence-2'],
    });

    expect(detectContradictions([older, newer])[0]).toMatchObject({
      preferredClaimId: newer.claimId,
      reason: 'newer_observation',
    });
  });

  it('treats verified presence as contradicting an absence claim', () => {
    const ledger = createLedger();
    const absent = addFact(ledger, {
      value: null,
      polarity: 'absent',
      status: 'not_found',
      kind: 'absence',
      text: 'Le service est absent.',
    });
    const present = addFact(ledger, {
      value: 'up',
      polarity: 'present',
      sourceRefs: ['evidence-2'],
    });

    expect(detectContradictions([absent, present])[0]).toMatchObject({
      type: 'presence_vs_absence',
      preferredClaimId: present.claimId,
      reason: 'verified_presence',
    });
  });
});

describe('response gate', () => {
  it('revises a draft containing an unknown citation', () => {
    const ledger = createLedger();
    const claim = addFact(ledger);

    expect(gateResponse({
      draft: { segments: [{ kind: 'factual', claimId: claim.claimId, text: claim.text }] },
      claims: [claim],
      citations: [{ claimId: claim.claimId, evidenceId: 'unknown' }],
      channel: 'local',
    })).toMatchObject({
      decision: 'revise',
      issues: expect.arrayContaining(['unknown_citation:claim-1:unknown']),
    });
  });

  it('revises a factual segment absent from the claim ledger', () => {
    expect(gateResponse({
      draft: { segments: [{ kind: 'factual', claimId: 'claim-missing', text: 'Fait non enregistré.' }] },
      claims: [],
      citations: [],
      channel: 'local',
    })).toMatchObject({
      decision: 'revise',
      issues: expect.arrayContaining(['claim_not_in_ledger:claim-missing']),
    });
  });

  it('allows a verified claim only when connected to a known citation', () => {
    const ledger = createLedger();
    const claim = addFact(ledger);

    expect(gateResponse({
      draft: { segments: [{ kind: 'factual', claimId: claim.claimId, text: claim.text }] },
      claims: [claim],
      citations: [{ claimId: claim.claimId, evidenceId: 'evidence-1' }],
      channel: 'local',
    })).toEqual({
      decision: 'allow',
      response: {
        text: 'Le service est actif.',
        citations: [{ claimId: 'claim-1', evidenceId: 'evidence-1' }],
      },
    });
  });

  it('labels inference and harmless uncertainty in French', () => {
    const ledger = createLedger();
    const inference = addFact(ledger, {
      kind: 'inference',
      status: 'inference',
      text: 'Le service semble stable.',
    });
    const uncertain = addFact(ledger, {
      key: 'weather.outlook',
      kind: 'fact',
      status: 'uncertain',
      text: 'La pluie reste possible.',
      sourceRefs: ['evidence-2'],
    });

    const result = gateResponse({
      draft: {
        segments: [
          { kind: 'factual', claimId: inference.claimId, text: inference.text },
          { kind: 'factual', claimId: uncertain.claimId, text: uncertain.text },
        ],
      },
      claims: [inference, uncertain],
      citations: [
        { claimId: inference.claimId, evidenceId: 'evidence-1' },
        { claimId: uncertain.claimId, evidenceId: 'evidence-2' },
      ],
      channel: 'voice',
    });

    expect(result).toMatchObject({ decision: 'allow' });
    expect(result.response.text).toBe('Inférence : Le service semble stable.\nIncertain : La pluie reste possible.');
  });

  it.each(['action', 'security', 'identity', 'secret'])('blocks an uncertain %s claim', (kind) => {
    const ledger = createLedger();
    const claim = addFact(ledger, { kind, status: 'uncertain' });

    expect(gateResponse({
      draft: { segments: [{ kind: 'factual', claimId: claim.claimId, text: claim.text }] },
      claims: [claim],
      citations: [{ claimId: claim.claimId, evidenceId: 'evidence-1' }],
      channel: 'telegram',
    })).toEqual({
      decision: 'block',
      safeResponse: 'Je ne peux pas confirmer cette information sensible avec les preuves disponibles.',
    });
  });

  it('revises a response when its claims contradict each other', () => {
    const ledger = createLedger();
    const first = addFact(ledger, { value: 'up' });
    const second = addFact(ledger, { value: 'down', sourceRefs: ['evidence-2'] });

    expect(gateResponse({
      draft: {
        segments: [
          { kind: 'factual', claimId: first.claimId, text: first.text },
          { kind: 'factual', claimId: second.claimId, text: second.text },
        ],
      },
      claims: [first, second],
      citations: [
        { claimId: first.claimId, evidenceId: 'evidence-1' },
        { claimId: second.claimId, evidenceId: 'evidence-2' },
      ],
      channel: 'local',
    })).toMatchObject({
      decision: 'revise',
      issues: ['contradiction:service.api.status'],
    });
  });
});
