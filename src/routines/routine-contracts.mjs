import { z } from 'zod';

export const ROUTINE_STATUSES = Object.freeze(['active', 'paused']);
export const TRIGGER_TYPES = Object.freeze(['schedule', 'event']);

const identifierSchema = z.string().min(1).max(128);

const valueFieldSchema = z.enum(['string', 'number', 'boolean']);

const stepSchema = z.strictObject({
  domain: z.string().min(1).max(80),
  operation: z.string().min(1).max(80),
  capability: z.string().min(1).max(200),
  fixedValues: z.record(z.string(), z.unknown()).default({}),
  valueSchema: z.record(z.string(), valueFieldSchema).default({}),
});

const scheduleTriggerSchema = z.strictObject({
  type: z.literal('schedule'),
  scheduleType: z.literal('daily'),
  hour: z.number().int().min(0).max(23),
  minute: z.number().int().min(0).max(59),
  timezone: z.string().min(1).max(80),
});

const eventTriggerSchema = z.strictObject({
  type: z.literal('event'),
  eventType: z.string().min(1).max(80),
});

const triggerSchema = z.discriminatedUnion('type', [scheduleTriggerSchema, eventTriggerSchema]);

const routineInputSchema = z.strictObject({
  name: z.string().min(1).max(200),
  trigger: triggerSchema,
  steps: z.array(stepSchema).min(1).max(20),
  status: z.enum(ROUTINE_STATUSES).default('active'),
});

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

export function validateRoutineInput(input) {
  return deepFreeze(routineInputSchema.parse(input));
}

export function validateRoutineId(routineId) {
  return identifierSchema.parse(routineId);
}
