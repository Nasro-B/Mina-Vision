function normalizeJson(value) {
  if (Array.isArray(value)) return value.map(normalizeJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, normalizeJson(value[key])]),
    );
  }
  return value;
}

function freezeContradiction(contradiction) {
  Object.freeze(contradiction.claimIds);
  return Object.freeze(contradiction);
}

export function detectContradictions(claims) {
  const byKey = new Map();
  for (const claim of claims) {
    if (!claim?.fact) continue;
    const group = byKey.get(claim.fact.key) ?? [];
    group.push(claim);
    byKey.set(claim.fact.key, group);
  }

  const contradictions = [];
  for (const [key, group] of byKey) {
    if (group.length < 2) continue;
    const polarities = new Set(group.map((claim) => claim.fact.polarity));
    const presentValues = new Set(
      group
        .filter((claim) => claim.fact.polarity === 'present')
        .map((claim) => JSON.stringify(normalizeJson(claim.fact.value))),
    );
    if (polarities.size === 1 && presentValues.size <= 1) continue;

    if (polarities.size > 1) {
      const verifiedPresence = group.find((claim) => (
        claim.fact.polarity === 'present' && claim.status === 'verified'
      ));
      contradictions.push(freezeContradiction({
        key,
        type: 'presence_vs_absence',
        claimIds: group.map((claim) => claim.claimId),
        preferredClaimId: verifiedPresence?.claimId ?? null,
        reason: verifiedPresence ? 'verified_presence' : 'unresolved_presence_conflict',
      }));
      continue;
    }

    const ordered = [...group].sort((left, right) => (
      Date.parse(right.fact.observedAt) - Date.parse(left.fact.observedAt)
    ));
    const newestIsUnique = Date.parse(ordered[0].fact.observedAt) > Date.parse(ordered[1].fact.observedAt);
    contradictions.push(freezeContradiction({
      key,
      type: 'incompatible_values',
      claimIds: group.map((claim) => claim.claimId),
      preferredClaimId: newestIsUnique ? ordered[0].claimId : null,
      reason: newestIsUnique ? 'newer_observation' : 'same_observation_time',
    }));
  }

  return Object.freeze(contradictions);
}
