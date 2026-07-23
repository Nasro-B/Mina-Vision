import { z } from 'zod';

// `mina_app` = chat natif de l'application Android appairée (constitution MINA.md § Canaux).
// Les enveloppes v1 (SMS/Telegram) gardent ce schéma ; les événements du chat utilisent la
// version 2 définie dans chat.mjs — les deux coexistent sans se casser.
export const CHANNELS = Object.freeze(['local', 'voice', 'sms', 'telegram', 'mina_app']);

const identifierSchema = z.string().min(1).max(128);
const isoDateSchema = z.string().datetime({ offset: true });

const envelopeSchema = z.strictObject({
  version: z.literal(1),
  id: identifierSchema,
  correlationId: identifierSchema,
  channel: z.enum(CHANNELS),
  kind: z.string().min(1).max(80),
  createdAt: isoDateSchema,
  expiresAt: isoDateSchema.nullable(),
  sender: z.strictObject({
    identityId: identifierSchema,
    deviceId: identifierSchema,
  }),
  counter: z.number().int().positive().safe(),
  algorithms: z.strictObject({
    encryption: z.literal('A256GCM'),
    signature: z.literal('ES256'),
  }),
  payloadCiphertext: z.string().min(1).max(1_048_576),
  nonce: z.string().min(1),
  authTag: z.string().min(1),
  signature: z.string().min(1),
}).superRefine((envelope, context) => {
  if (envelope.expiresAt && Date.parse(envelope.expiresAt) < Date.parse(envelope.createdAt)) {
    context.addIssue({
      code: 'custom',
      path: ['expiresAt'],
      message: 'Expiration must not be earlier than creation',
    });
  }
});

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

export function parseEnvelope(value) {
  return deepFreeze(envelopeSchema.parse(value));
}
