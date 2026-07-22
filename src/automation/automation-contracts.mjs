import { z } from 'zod';

export const AUTOMATION_STATUSES = Object.freeze(['draft', 'shadow', 'supervised', 'active', 'suspended', 'revoked']);

export const NEXT = Object.freeze({
  draft: new Set(['shadow', 'revoked']),
  shadow: new Set(['supervised', 'suspended', 'revoked']),
  supervised: new Set(['active', 'suspended', 'revoked']),
  active: new Set(['suspended', 'revoked']),
  suspended: new Set(['shadow', 'revoked']),
  revoked: new Set(),
});

export function canTransition(fromStatus, toStatus) {
  return NEXT[fromStatus]?.has(toStatus) ?? false;
}

const allowedActionSchema = z.strictObject({
  actionType: z.string().min(1).max(80),
  capability: z.string().min(1).max(200),
});

const definitionInputSchema = z.strictObject({
  name: z.string().min(1).max(200),
  description: z.string().max(2000),
  status: z.enum(AUTOMATION_STATUSES),
  allowedActions: z.array(allowedActionSchema).max(50).default([]),
});

export function isActionAllowed(definition, action) {
  return (definition?.allowedActions ?? []).some(
    (allowed) => allowed.actionType === action?.actionType && allowed.capability === action?.capability,
  );
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

export function validateAutomationDefinition(input) {
  return deepFreeze(definitionInputSchema.parse(input));
}

const identifierSchema = z.string().min(1).max(128);
const isoDateSchema = z.string().datetime({ offset: true });

const scheduleSchema = z.strictObject({
  allowedDays: z.array(z.number().int().min(0).max(6)).min(1),
  startHour: z.number().int().min(0).max(23),
  endHour: z.number().int().min(0).max(23),
});

const grantInputSchema = z.strictObject({
  automationId: identifierSchema,
  digest: z.string().regex(/^[a-f0-9]{64}$/u),
  expiresAt: isoDateSchema,
  resourceScope: z.array(z.string().min(1).max(200)).min(1),
  channelScope: z.array(z.string().min(1).max(80)).min(1),
  schedule: scheduleSchema.nullable(),
  maxRiskLevel: z.number().int().positive(),
  maxFrequencyPerWindow: z.number().int().positive(),
  maxCostMicros: z.number().int().positive(),
  maxDurationMs: z.number().int().positive(),
});

export function validateAutomationGrant(input) {
  return deepFreeze(grantInputSchema.parse(input));
}
