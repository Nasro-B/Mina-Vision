import { z } from 'zod';

const identifierSchema = z.string().min(1).max(128);
const isoDateSchema = z.string().datetime({ offset: true });
const revisionSchema = z.string({ error: () => 'revision_required' }).min(1, 'revision_required');

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

const attendeeSchema = z.strictObject({
  email: z.string().email(),
  responseStatus: z.enum(['needsAction', 'accepted', 'declined', 'tentative']),
});

const calendarEventSchema = z.strictObject({
  eventId: identifierSchema,
  providerId: identifierSchema,
  calendarId: identifierSchema,
  title: z.string().min(1).max(500),
  description: z.string().max(10_000).default(''),
  location: z.string().max(500).default(''),
  startAt: isoDateSchema,
  endAt: isoDateSchema,
  allDay: z.boolean().default(false),
  attendees: z.array(attendeeSchema).default([]),
  revision: revisionSchema,
}).superRefine((event, context) => {
  if (Date.parse(event.endAt) < Date.parse(event.startAt)) {
    context.addIssue({ code: 'custom', path: ['endAt'], message: 'calendar_event_end_before_start' });
  }
});

export function validateCalendarEvent(input) {
  return deepFreeze(calendarEventSchema.parse(input));
}

const endpointSchema = z.strictObject({
  channel: z.enum(['email', 'phone', 'telegram']),
  value: z.string().min(1).max(320),
  verified: z.boolean(),
});

const personSchema = z.strictObject({
  personId: identifierSchema,
  providerId: identifierSchema,
  displayName: z.string().min(1).max(300),
  endpoints: z.array(endpointSchema).default([]),
  revision: revisionSchema,
});

export function validatePerson(input) {
  return deepFreeze(personSchema.parse(input));
}

const taskSchema = z.strictObject({
  taskId: identifierSchema,
  providerId: identifierSchema,
  title: z.string().min(1).max(500),
  status: z.enum(['proposed', 'active', 'completed', 'cancelled']),
  dueAt: isoDateSchema.nullable().default(null),
  sourceRef: z.string().min(1).max(300).nullable().default(null),
  revision: revisionSchema,
});

export function validateTask(input) {
  return deepFreeze(taskSchema.parse(input));
}

const syncPageSchema = z.strictObject({
  items: z.array(z.unknown()),
  cursor: z.string().min(1).nullable(),
  hasMore: z.boolean(),
});

export function validateSyncPage(input) {
  return deepFreeze(syncPageSchema.parse(input));
}
