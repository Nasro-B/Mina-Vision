import { describe, expect, it } from 'vitest';
import { createClaimLedger } from '../src/grounding/claim-ledger.mjs';
import { createEvidenceValidator } from '../src/grounding/evidence-validator.mjs';

function createLedger() {
  let id = 0;
  return createClaimLedger({
    clock: () => Date.parse('2026-07-15T00:00:00.000Z'),
    ids: () => `claim-${++id}`,
  });
}

describe('claim ledger', () => {
  it('adds immutable canonical claims and preserves insertion order', () => {
    const ledger = createLedger();
    const first = ledger.add({
      sessionId: 'work-1',
      text: 'Le bouton est visible.',
      kind: 'observed_state',
      sourceRefs: ['source-1'],
      status: 'verified',
      fact: {
        key: 'page.search.button.visible',
        value: true,
        observedAt: '2026-07-15T00:00:00.000Z',
        polarity: 'present',
      },
    });
    const second = ledger.add({
      sessionId: 'work-1',
      text: 'La page semble prête.',
      kind: 'inference',
      sourceRefs: ['source-1'],
      status: 'inference',
    });

    expect(first).toMatchObject({
      claimId: 'claim-1',
      claimType: 'observed_state',
      evidenceIds: ['source-1'],
      sourcePolicy: 'observed_source',
      fact: { key: 'page.search.button.visible', value: true },
    });
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.evidenceIds)).toBe(true);
    expect(ledger.list('work-1')).toEqual([first, second]);
    expect(ledger.get('claim-2')).toBe(second);
  });

  it('rejects an unknown status through the versioned claim contract', () => {
    const ledger = createLedger();

    expect(() => ledger.add({
      sessionId: 'work-1',
      text: 'Affirmation',
      kind: 'fact',
      sourceRefs: [],
      status: 'likely',
    })).toThrow();
  });

  it('replaces a claim status only from an evidence-validator result and preserves canonical fields', () => {
    const ledger = createLedger();
    const original = ledger.add({
      sessionId: 'work-1',
      text: 'ADB est connecté.',
      kind: 'current_state',
      sourceRefs: ['adb-1'],
      status: 'unsupported',
    });
    const validator = createEvidenceValidator({ clock: () => Date.parse('2026-07-15T00:00:00.000Z') });
    const validation = validator.validate(original, [{
      sourceId: 'adb-1',
      locator: 'adb devices',
      capturedAt: '2026-07-15T00:00:00.000Z',
      contentDigest: 'a',
      freshnessClass: 'current',
      extract: 'device',
      method: 'tool_output',
    }]);

    expect(() => ledger.applyValidation({ claimId: original.claimId, validation: { status: 'verified' } }))
      .toThrow('claim_validation_result_required');

    const updated = ledger.applyValidation({ claimId: original.claimId, validation });

    expect(updated).toMatchObject({
      claimId: original.claimId,
      sessionId: original.sessionId,
      text: original.text,
      createdAt: original.createdAt,
      status: 'verified',
    });
    expect(ledger.get(original.claimId)).toBe(updated);
    expect(ledger.list('work-1')).toEqual([updated]);
  });
});
