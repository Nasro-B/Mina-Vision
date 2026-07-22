import { describe, expect, it } from 'vitest';
import { project, RECOVERY_CLASSIFICATIONS } from '../src/recovery/recovery-projector.mjs';

function run(overrides = {}) {
  return {
    accepted: true,
    cancelled: false,
    verified: null,
    effectConfirmedAbsent: false,
    reconcilerAvailable: false,
    reconciliationAttempted: false,
    ...overrides,
  };
}

describe('RECOVERY_CLASSIFICATIONS: exact six-class vocabulary', () => {
  it('lists exactly the six classes named by the plan', () => {
    expect([...RECOVERY_CLASSIFICATIONS]).toEqual([
      'verified_complete', 'denied_or_cancelled', 'failed_no_effect',
      'accepted_state_unknown', 'reconcilable', 'manual_action_required',
    ]);
  });
});

describe('project: the exact case given by the plan', () => {
  it('classifies an accepted-but-unverified case as accepted_state_unknown with reconcile + close_manually', () => {
    expect(project(run({ accepted: true, verified: false }))).toMatchObject({
      classification: 'accepted_state_unknown',
      allowedActions: ['reconcile', 'close_manually'],
    });
  });
});

describe('project: verified_complete', () => {
  it('classifies a confirmed-verified case as complete with nothing left to do, even if it was also cancelled', () => {
    expect(project(run({ verified: true, cancelled: true }))).toMatchObject({
      classification: 'verified_complete',
      allowedActions: [],
    });
  });
});

describe('project: denied_or_cancelled', () => {
  it('classifies an unaccepted (policy-denied) case as denied_or_cancelled', () => {
    expect(project(run({ accepted: false }))).toMatchObject({ classification: 'denied_or_cancelled', allowedActions: [] });
  });

  it('classifies a cancelled case with nothing verified as denied_or_cancelled', () => {
    expect(project(run({ accepted: true, cancelled: true, verified: null }))).toMatchObject({
      classification: 'denied_or_cancelled', allowedActions: [],
    });
  });
});

describe('project: failed_no_effect — retry only appears once a reconciler proves no effect', () => {
  it('classifies a reconciler-confirmed-absent effect as failed_no_effect and offers retry', () => {
    expect(project(run({ effectConfirmedAbsent: true }))).toMatchObject({
      classification: 'failed_no_effect',
      allowedActions: ['retry', 'close_manually'],
    });
  });

  it('never offers retry for any other classification', () => {
    const cases = [
      run({ verified: true }),
      run({ accepted: false }),
      run({ accepted: true, cancelled: true }),
      run({ accepted: true, verified: false }),
      run({ accepted: true, verified: false, reconciliationAttempted: true, reconcilerAvailable: true }),
      run({ accepted: true, verified: false, reconciliationAttempted: true, reconcilerAvailable: false }),
    ];
    for (const caseInput of cases) {
      expect(project(caseInput).allowedActions).not.toContain('retry');
    }
  });
});

describe('project: reconcilable vs manual_action_required — after a reconciliation attempt', () => {
  it('classifies a still-unresolved case as reconcilable when a reconciler remains available', () => {
    expect(project(run({ accepted: true, verified: false, reconciliationAttempted: true, reconcilerAvailable: true })))
      .toMatchObject({ classification: 'reconcilable', allowedActions: ['reconcile', 'close_manually'] });
  });

  it('classifies a still-unresolved case with no reconciler as manual_action_required, reconcile no longer offered', () => {
    expect(project(run({ accepted: true, verified: false, reconciliationAttempted: true, reconcilerAvailable: false })))
      .toMatchObject({ classification: 'manual_action_required', allowedActions: ['close_manually'] });
  });
});

describe('project: close_manually is always available whenever the case is not already terminal-resolved', () => {
  it('is present for every unresolved classification', () => {
    const unresolved = [
      run({ accepted: true, verified: false }),
      run({ effectConfirmedAbsent: true }),
      run({ accepted: true, verified: false, reconciliationAttempted: true, reconcilerAvailable: true }),
      run({ accepted: true, verified: false, reconciliationAttempted: true, reconcilerAvailable: false }),
    ];
    for (const caseInput of unresolved) {
      expect(project(caseInput).allowedActions).toContain('close_manually');
    }
  });
});
