import { z } from 'zod';
import { canonicalJson } from '../crypto/canonical-json.mjs';
import { sha256 } from '../crypto/digest.mjs';

export const APPROVAL_STATUSES = Object.freeze(['pending', 'approved', 'denied', 'expired', 'invalidated', 'consumed']);
const MAX_APPROVAL_WINDOW_MS = 5 * 60 * 1000;

const identifierSchema = z.string().min(1).max(300);
const isoDateSchema = z.string().datetime({ offset: true });

const digestInputSchema = z.strictObject({
  capability: z.string().min(1).max(200),
  resourceDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  actionDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  observedStateDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  expectedEffect: z.record(z.string(), z.unknown()),
  disclosedData: z.record(z.string(), z.unknown()),
  expiresAt: isoDateSchema,
  nonce: identifierSchema,
});

const requestInputSchema = digestInputSchema.extend({
  locality: z.enum(['local_only', 'remote_eligible']),
});

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

export function validateApprovalRequestInput(input) {
  return deepFreeze(requestInputSchema.parse(input));
}

export function computeApprovalDigest(input) {
  // Accepts either a bare digest-input object or a full request (which also carries `locality`);
  // only pick+validate the fields that participate in the digest, ignoring anything else.
  const { capability, resourceDigest, actionDigest, observedStateDigest, expectedEffect, disclosedData, expiresAt, nonce } = digestInputSchema.parse({
    capability: input.capability, resourceDigest: input.resourceDigest, actionDigest: input.actionDigest,
    observedStateDigest: input.observedStateDigest, expectedEffect: input.expectedEffect, disclosedData: input.disclosedData,
    expiresAt: input.expiresAt, nonce: input.nonce,
  });
  return `sha256:${sha256(canonicalJson({ capability, resourceDigest, actionDigest, observedStateDigest, expectedEffect, disclosedData, expiresAt, nonce }))}`;
}

export function assertWithinApprovalWindow(expiresAt, nowMs) {
  const expiryMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiryMs) || expiryMs <= nowMs) throw new Error('approval_expires_at_invalid');
  if (expiryMs - nowMs > MAX_APPROVAL_WINDOW_MS) throw new Error('approval_window_too_long');
}

export { MAX_APPROVAL_WINDOW_MS };
