import { z } from 'zod';

export const CLAIM_STATUS = Object.freeze([
  'verified',
  'inference',
  'uncertain',
  'not_found',
  'unsupported',
  'stale',
]);

const identifierSchema = z.string().min(1).max(128);
const isoDateSchema = z.string().datetime({ offset: true });
const jsonValueSchema = z.lazy(() => z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(jsonValueSchema),
  z.record(z.string(), jsonValueSchema),
]));

const factSchema = z.strictObject({
  key: z.string().min(1).max(256),
  value: jsonValueSchema,
  observedAt: isoDateSchema,
  polarity: z.enum(['present', 'absent']),
});

const claimSchema = z.strictObject({
  claimId: identifierSchema,
  sessionId: identifierSchema,
  text: z.string().min(1),
  claimType: z.string().min(1).max(80),
  status: z.enum(CLAIM_STATUS),
  evidenceIds: z.array(identifierSchema),
  sourcePolicy: z.string().min(1).max(80),
  freshnessDeadline: isoDateSchema.nullable(),
  sensitivity: z.string().min(1).max(80),
  createdAt: isoDateSchema,
  fact: factSchema.nullable().default(null),
});

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

export function parseClaim(value) {
  return deepFreeze(claimSchema.parse(value));
}
