import { z } from 'zod';

const identifierSchema = z.string().min(1).max(128);

const triggerSchema = z.strictObject({
  triggerId: identifierSchema,
  type: z.string().min(1).max(80),
  occurredAt: z.string().datetime({ offset: true }),
  payload: z.record(z.string(), z.unknown()).default({}),
});

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

export function normalizeTrigger(raw) {
  return deepFreeze(triggerSchema.parse(raw));
}
