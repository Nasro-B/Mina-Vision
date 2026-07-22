import { randomUUID } from 'node:crypto';
import { parseClaim } from '../contracts/claims.mjs';
import { sourcePolicyForClaim } from './source-policy.mjs';

export function createClaimLedger({ clock = Date.now, ids = () => randomUUID() } = {}) {
  const claims = [];
  const byId = new Map();
  const now = () => Number(typeof clock === 'function' ? clock() : clock.now());
  const nextId = () => String(typeof ids === 'function' ? ids('claim') : ids.next('claim'));

  return Object.freeze({
    add({
      sessionId,
      text,
      kind,
      sourceRefs = [],
      status = 'unsupported',
      sourcePolicy = sourcePolicyForClaim(kind),
      freshnessDeadline = null,
      sensitivity = 'personal',
      fact = null,
    }) {
      const claim = parseClaim({
        claimId: nextId(),
        sessionId,
        text,
        claimType: kind,
        status,
        evidenceIds: [...sourceRefs],
        sourcePolicy,
        freshnessDeadline,
        sensitivity,
        createdAt: new Date(now()).toISOString(),
        fact,
      });
      claims.push(claim);
      byId.set(claim.claimId, claim);
      return claim;
    },
    get(claimId) {
      return byId.get(claimId) ?? null;
    },
    list(sessionId = null) {
      return Object.freeze(claims.filter((claim) => sessionId === null || claim.sessionId === sessionId));
    },
  });
}
