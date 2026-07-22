import { z } from 'zod';

export const DOCUMENT_STATUSES = Object.freeze(['inspectable', 'quarantined', 'blocked']);

const identifierSchema = z.string().min(1).max(128);
const isoDateSchema = z.string().datetime({ offset: true });

const documentItemSchema = z.strictObject({
  documentId: identifierSchema,
  digest: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  source: z.string().min(1).max(80),
  declaredName: z.string().max(500),
  detectedType: z.string().min(1).max(200),
  size: z.number().int().nonnegative(),
  status: z.enum(DOCUMENT_STATUSES),
  reasons: z.array(z.string().min(1).max(200)),
  observedAt: isoDateSchema,
});

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

export function validateDocumentItem(input) {
  return deepFreeze(documentItemSchema.parse(input));
}
