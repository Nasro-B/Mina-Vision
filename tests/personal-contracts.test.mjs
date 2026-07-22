import { describe, expect, it } from 'vitest';
import {
  validateCalendarEvent, validatePerson, validateTask, validateSyncPage,
} from '../src/personal/personal-contracts.mjs';

function validEvent(overrides = {}) {
  return {
    eventId: 'e1', providerId: 'google', calendarId: 'primary', title: 'RDV',
    startAt: '2026-07-20T09:00:00.000Z', endAt: '2026-07-20T10:00:00.000Z', revision: 'r1',
    ...overrides,
  };
}

function validPerson(overrides = {}) {
  return { personId: 'p1', providerId: 'google', displayName: 'Alice', revision: 'r1', ...overrides };
}

function validTask(overrides = {}) {
  return { taskId: 't1', providerId: 'google', title: 'Rappeler Alice', status: 'proposed', revision: 'r1', ...overrides };
}

describe('validateCalendarEvent', () => {
  it('rejects a provider object without a stable revision', () => {
    expect(() => validateCalendarEvent({ providerId: 'x', title: 'A' })).toThrow('revision_required');
  });

  it('accepts a well-formed event and defaults allDay/attendees', () => {
    const event = validateCalendarEvent(validEvent());
    expect(event.allDay).toBe(false);
    expect(event.attendees).toEqual([]);
    expect(Object.isFrozen(event)).toBe(true);
  });

  it('rejects endAt before startAt', () => {
    expect(() => validateCalendarEvent(validEvent({ startAt: '2026-07-20T10:00:00.000Z', endAt: '2026-07-20T09:00:00.000Z' })))
      .toThrow('calendar_event_end_before_start');
  });

  it('accepts attendees with email and responseStatus', () => {
    const event = validateCalendarEvent(validEvent({ attendees: [{ email: 'a@example.com', responseStatus: 'accepted' }] }));
    expect(event.attendees).toEqual([{ email: 'a@example.com', responseStatus: 'accepted' }]);
  });
});

describe('validatePerson', () => {
  it('rejects a person without a revision', () => {
    expect(() => validatePerson({ personId: 'p1', providerId: 'google', displayName: 'Alice' })).toThrow('revision_required');
  });

  it('accepts a well-formed person and defaults endpoints to empty', () => {
    const person = validatePerson(validPerson());
    expect(person.endpoints).toEqual([]);
    expect(Object.isFrozen(person)).toBe(true);
  });

  it('accepts endpoints with channel/value/verified', () => {
    const person = validatePerson(validPerson({ endpoints: [{ channel: 'email', value: 'a@example.com', verified: false }] }));
    expect(person.endpoints[0]).toEqual({ channel: 'email', value: 'a@example.com', verified: false });
  });

  it('rejects an endpoint with an unknown channel', () => {
    expect(() => validatePerson(validPerson({ endpoints: [{ channel: 'fax', value: '123', verified: false }] }))).toThrow();
  });
});

describe('validateTask', () => {
  it('rejects a task without a revision', () => {
    expect(() => validateTask({ taskId: 't1', providerId: 'google', title: 'x', status: 'proposed' })).toThrow('revision_required');
  });

  it('accepts a well-formed task and defaults dueAt/sourceRef to null', () => {
    const task = validateTask(validTask());
    expect(task.dueAt).toBeNull();
    expect(task.sourceRef).toBeNull();
  });

  it('rejects a status outside the four-state vocabulary', () => {
    expect(() => validateTask(validTask({ status: 'archived' }))).toThrow();
  });
});

describe('validateSyncPage', () => {
  it('rejects a page missing cursor/hasMore', () => {
    expect(() => validateSyncPage({ items: [] })).toThrow();
  });

  it('accepts a well-formed page', () => {
    const page = validateSyncPage({ items: [], cursor: null, hasMore: false });
    expect(page).toEqual({ items: [], cursor: null, hasMore: false });
  });
});
