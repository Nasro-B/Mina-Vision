import { z } from 'zod';
import { rankSource } from './source-policy.mjs';

const evidenceSchema = z.strictObject({
  sourceId: z.string().min(1).max(128),
  locator: z.string().min(1),
  capturedAt: z.string().datetime({ offset: true }),
  contentDigest: z.string().min(1),
  freshnessClass: z.enum(['current', 'volatile', 'stable', 'historical']),
  extract: z.string(),
  method: z.enum([
    'observed',
    'tool_output',
    'current_state_query',
    'structured_extraction',
    'document',
    'absence_query',
    'model_inference',
  ]),
  scope: z.string().min(1).optional(),
  query: z.string().min(1).optional(),
  executedAt: z.string().datetime({ offset: true }).optional(),
  result: z.unknown().optional(),
  exhaustive: z.boolean().optional(),
});

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function result(status, acceptedEvidence, reasons) {
  return deepFreeze({ status, acceptedEvidence, reasons });
}

function isEmpty(value) {
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'string') return value.length === 0;
  return value === null;
}

function isCompleteAbsenceProof(source) {
  return source.method === 'absence_query'
    && source.freshnessClass === 'current'
    && Boolean(source.scope)
    && Boolean(source.query)
    && Boolean(source.executedAt)
    && source.exhaustive === true
    && Object.hasOwn(source, 'result')
    && isEmpty(source.result);
}

export function createEvidenceValidator({ clock = Date.now } = {}) {
  const now = () => Number(typeof clock === 'function' ? clock() : clock.now());

  return Object.freeze({
    validate(claim, evidence = []) {
      if (!claim.evidenceIds?.length) {
        return result('unsupported', [], ['claim_has_no_source_reference']);
      }

      const referencedIds = new Set(claim.evidenceIds);
      const reasons = [];
      const acceptedEvidence = [];
      for (const candidate of evidence) {
        if (!referencedIds.has(candidate?.sourceId)) continue;
        const parsed = evidenceSchema.safeParse(candidate);
        if (!parsed.success) {
          reasons.push(`invalid_evidence:${candidate?.sourceId ?? 'unknown'}`);
          continue;
        }
        acceptedEvidence.push(deepFreeze(parsed.data));
      }
      acceptedEvidence.sort((left, right) => rankSource(right.method) - rankSource(left.method));

      if (!acceptedEvidence.length) {
        return result('unsupported', [], reasons.length ? reasons : ['no_referenced_evidence']);
      }

      if (claim.freshnessDeadline && now() > Date.parse(claim.freshnessDeadline)) {
        return result('stale', acceptedEvidence, [...reasons, 'claim_freshness_deadline_expired']);
      }

      if (claim.claimType === 'current_state') {
        const live = acceptedEvidence.some((source) => (
          ['current_state_query', 'observed', 'tool_output'].includes(source.method)
          && source.freshnessClass === 'current'
        ));
        if (!live) {
          return result('stale', acceptedEvidence, [...reasons, 'current_state_requires_live_evidence']);
        }
      }

      if (claim.claimType === 'absence') {
        if (acceptedEvidence.some(isCompleteAbsenceProof)) {
          return result('not_found', acceptedEvidence, reasons);
        }
        return result('uncertain', acceptedEvidence, [...reasons, 'absence_scope_not_exhaustive']);
      }

      if (claim.claimType === 'inference' || claim.status === 'inference') {
        return result('inference', acceptedEvidence, reasons);
      }

      if (rankSource(acceptedEvidence[0].method) >= rankSource('structured_extraction')) {
        return result('verified', acceptedEvidence, reasons);
      }

      return result('uncertain', acceptedEvidence, [...reasons, 'source_is_inference_only']);
    },
  });
}
