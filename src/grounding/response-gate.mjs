import { detectContradictions } from './contradiction-detector.mjs';

const SENSITIVE_CLAIM_TYPES = new Set(['action', 'security', 'identity', 'secret']);

function freezeResult(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freezeResult(child);
  }
  return value;
}

export function gateResponse({ draft, claims, citations, channel: _channel }) {
  const claimById = new Map(claims.map((claim) => [claim.claimId, claim]));
  const issues = [];

  for (const segment of draft.segments ?? []) {
    if (segment.kind !== 'factual') continue;
    const claim = claimById.get(segment.claimId);
    if (!claim) {
      issues.push(`claim_not_in_ledger:${segment.claimId ?? 'missing'}`);
      continue;
    }
    if (SENSITIVE_CLAIM_TYPES.has(claim.claimType) && claim.status !== 'verified') {
      return freezeResult({
        decision: 'block',
        safeResponse: 'Je ne peux pas confirmer cette information sensible avec les preuves disponibles.',
      });
    }
  }

  const validCitationKeys = new Set();
  for (const citation of citations) {
    const claim = claimById.get(citation.claimId);
    if (!claim || !claim.evidenceIds.includes(citation.evidenceId)) {
      issues.push(`unknown_citation:${citation.claimId}:${citation.evidenceId}`);
      continue;
    }
    validCitationKeys.add(`${citation.claimId}:${citation.evidenceId}`);
  }

  for (const segment of draft.segments ?? []) {
    if (segment.kind !== 'factual') continue;
    const claim = claimById.get(segment.claimId);
    if (!claim) continue;
    const hasCitation = claim.evidenceIds.some((evidenceId) => (
      validCitationKeys.has(`${claim.claimId}:${evidenceId}`)
    ));
    if (!hasCitation) issues.push(`missing_citation:${claim.claimId}`);
    if (claim.status === 'unsupported') issues.push(`unsupported_claim:${claim.claimId}`);
  }

  for (const contradiction of detectContradictions(claims)) {
    issues.push(`contradiction:${contradiction.key}`);
  }

  if (issues.length) return freezeResult({ decision: 'revise', issues });

  const rendered = (draft.segments ?? []).map((segment) => {
    if (segment.kind !== 'factual') return segment.text;
    const claim = claimById.get(segment.claimId);
    if (claim.status === 'inference') return `Inférence : ${segment.text}`;
    if (['uncertain', 'stale'].includes(claim.status)) return `Incertain : ${segment.text}`;
    return segment.text;
  });

  return freezeResult({
    decision: 'allow',
    response: {
      text: rendered.join('\n'),
      citations: [...citations],
    },
  });
}
