import { z } from 'zod';
import { CHANNELS } from './envelope.mjs';

const identifierSchema = z.string().min(1).max(128);

const sessionEventSchema = z.strictObject({
  eventId: identifierSchema,
  runtimeSessionId: identifierSchema,
  workSessionId: identifierSchema.nullable(),
  type: z.string().min(1).max(80),
  occurredAt: z.string().datetime({ offset: true }),
  channel: z.enum(CHANNELS),
  payload: z.record(z.string(), z.unknown()),
});

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

export function parseSessionEvent(value) {
  return deepFreeze(sessionEventSchema.parse(value));
}
