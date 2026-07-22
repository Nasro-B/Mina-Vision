export const SOURCE_RANK = Object.freeze({
  model_inference: 1,
  document: 2,
  structured_extraction: 2,
  absence_query: 3,
  current_state_query: 3,
  observed: 3,
  tool_output: 3,
});

export function rankSource(method) {
  return SOURCE_RANK[method] ?? 0;
}

export function sourcePolicyForClaim(claimType) {
  if (claimType === 'current_state') return 'current_state';
  if (claimType === 'absence') return 'exhaustive_search';
  if (claimType === 'inference') return 'declared_inference';
  return 'observed_source';
}
