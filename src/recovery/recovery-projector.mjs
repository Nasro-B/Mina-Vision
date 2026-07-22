export const RECOVERY_CLASSIFICATIONS = Object.freeze([
  'verified_complete',
  'denied_or_cancelled',
  'failed_no_effect',
  'accepted_state_unknown',
  'reconcilable',
  'manual_action_required',
]);

function classify(caseInput) {
  if (caseInput.verified === true) return 'verified_complete';
  if (!caseInput.accepted) return 'denied_or_cancelled';
  if (caseInput.effectConfirmedAbsent) return 'failed_no_effect';
  if (caseInput.cancelled) return 'denied_or_cancelled';
  if (!caseInput.reconciliationAttempted) return 'accepted_state_unknown';
  return caseInput.reconcilerAvailable ? 'reconcilable' : 'manual_action_required';
}

const ALLOWED_ACTIONS_BY_CLASSIFICATION = Object.freeze({
  verified_complete: Object.freeze([]),
  denied_or_cancelled: Object.freeze([]),
  failed_no_effect: Object.freeze(['retry', 'close_manually']),
  accepted_state_unknown: Object.freeze(['reconcile', 'close_manually']),
  reconcilable: Object.freeze(['reconcile', 'close_manually']),
  manual_action_required: Object.freeze(['close_manually']),
});

export function project(caseInput) {
  const classification = classify(caseInput);
  return Object.freeze({ classification, allowedActions: ALLOWED_ACTIONS_BY_CLASSIFICATION[classification] });
}
