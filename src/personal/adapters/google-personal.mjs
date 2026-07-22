import { validateCalendarEvent, validatePerson, validateTask } from '../personal-contracts.mjs';

const CALENDAR_URL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
const PEOPLE_URL = 'https://people.googleapis.com/v1/people/me/connections';
const TASKS_URL = 'https://tasks.googleapis.com/tasks/v1/lists/@default/tasks';

function normalizeEvent(raw) {
  const start = raw.start?.dateTime ?? (raw.start?.date ? `${raw.start.date}T00:00:00.000Z` : null);
  const end = raw.end?.dateTime ?? (raw.end?.date ? `${raw.end.date}T00:00:00.000Z` : null);
  return validateCalendarEvent({
    eventId: raw.id,
    providerId: 'google',
    calendarId: 'primary',
    title: raw.summary ?? '(sans titre)',
    description: raw.description ?? '',
    location: raw.location ?? '',
    startAt: new Date(start).toISOString(),
    endAt: new Date(end).toISOString(),
    allDay: Boolean(raw.start?.date),
    attendees: (raw.attendees ?? []).map((attendee) => ({ email: attendee.email, responseStatus: attendee.responseStatus ?? 'needsAction' })),
    revision: raw.etag,
  });
}

function normalizePerson(raw) {
  const endpoints = [
    ...(raw.emailAddresses ?? []).map((entry) => ({ channel: 'email', value: entry.value, verified: true })),
    ...(raw.phoneNumbers ?? []).map((entry) => ({ channel: 'phone', value: entry.value, verified: true })),
  ];
  return validatePerson({
    personId: raw.resourceName,
    providerId: 'google',
    displayName: raw.names?.[0]?.displayName ?? '(sans nom)',
    endpoints,
    revision: raw.etag,
  });
}

function normalizeTask(raw) {
  return validateTask({
    taskId: raw.id,
    providerId: 'google',
    title: raw.title ?? '(sans titre)',
    status: raw.status === 'completed' ? 'completed' : 'active',
    dueAt: raw.due ?? null,
    sourceRef: null,
    revision: raw.etag,
  });
}

function isExpiredSyncToken(error) {
  return error?.status === 410;
}

function isRevoked(error) {
  return error?.status === 401 || /invalid_grant/u.test(error?.message ?? '');
}

export function createGooglePersonalAdapter({ oauth, credentialsProvider, clock = Date.now } = {}) {
  if (!oauth?.request) throw new TypeError('google_personal_oauth_required');
  if (typeof credentialsProvider !== 'function') throw new TypeError('google_personal_credentials_provider_required');
  const now = () => Number(typeof clock === 'function' ? clock() : clock.now());

  async function call(options) {
    const credentials = await credentialsProvider();
    const response = await oauth.request(credentials, options);
    return response.data;
  }

  return Object.freeze({
    id: 'google',

    async create({ title, dueAt = null, sourceRef = null } = {}) {
      if (typeof title !== 'string' || title.trim().length < 1 || title.length > 500) {
        throw new TypeError('google_task_title_invalid');
      }
      const data = await call({
        url: TASKS_URL,
        method: 'POST',
        data: { title: title.trim(), ...(dueAt ? { due: new Date(dueAt).toISOString() } : {}), ...(sourceRef ? { notes: sourceRef } : {}) },
      });
      if (typeof data?.id !== 'string' || !data.id || typeof data?.etag !== 'string' || !data.etag) {
        throw new Error('google_task_create_response_invalid');
      }
      return Object.freeze({ taskId: data.id, revision: data.etag });
    },

    async complete(taskId) {
      if (typeof taskId !== 'string' || !taskId) throw new TypeError('google_task_id_invalid');
      const data = await call({ url: `${TASKS_URL}/${encodeURIComponent(taskId)}`, method: 'PATCH', data: { status: 'completed' } });
      if (typeof data?.etag !== 'string' || !data.etag) throw new Error('google_task_complete_response_invalid');
      return Object.freeze({ revision: data.etag });
    },

    async cancel(taskId) {
      if (typeof taskId !== 'string' || !taskId) throw new TypeError('google_task_id_invalid');
      await call({ url: `${TASKS_URL}/${encodeURIComponent(taskId)}`, method: 'DELETE' });
      return Object.freeze({ cancelled: true });
    },

    async createEvent({ title, startAt, endAt, location = null, description = null } = {}) {
      if (typeof title !== 'string' || title.trim().length < 1 || title.length > 500) {
        throw new TypeError('google_event_title_invalid');
      }
      if (!(new Date(startAt).getTime() < new Date(endAt).getTime())) throw new TypeError('google_event_time_range_invalid');
      const data = await call({
        url: CALENDAR_URL,
        method: 'POST',
        data: {
          summary: title.trim(), start: { dateTime: new Date(startAt).toISOString() }, end: { dateTime: new Date(endAt).toISOString() },
          ...(location ? { location } : {}), ...(description ? { description } : {}),
        },
      });
      if (typeof data?.id !== 'string' || !data.id || typeof data?.etag !== 'string' || !data.etag) {
        throw new Error('google_event_create_response_invalid');
      }
      return Object.freeze({ eventId: data.id, revision: data.etag });
    },

    async getEvent(eventId) {
      if (typeof eventId !== 'string' || !eventId) throw new TypeError('google_event_id_invalid');
      const data = await call({ url: `${CALENDAR_URL}/${encodeURIComponent(eventId)}`, method: 'GET' });
      return normalizeEvent(data);
    },

    async updateEvent({ eventId, patch } = {}) {
      if (typeof eventId !== 'string' || !eventId) throw new TypeError('google_event_id_invalid');
      const data = await call({
        url: `${CALENDAR_URL}/${encodeURIComponent(eventId)}`,
        method: 'PATCH',
        data: {
          ...(patch.title !== undefined ? { summary: patch.title } : {}),
          ...(patch.startAt !== undefined ? { start: { dateTime: new Date(patch.startAt).toISOString() } } : {}),
          ...(patch.endAt !== undefined ? { end: { dateTime: new Date(patch.endAt).toISOString() } } : {}),
          ...(patch.location !== undefined ? { location: patch.location } : {}),
          ...(patch.description !== undefined ? { description: patch.description } : {}),
        },
      });
      if (typeof data?.etag !== 'string' || !data.etag) throw new Error('google_event_update_response_invalid');
      return Object.freeze({ revision: data.etag });
    },

    async cancelEvent(eventId) {
      if (typeof eventId !== 'string' || !eventId) throw new TypeError('google_event_id_invalid');
      await call({ url: `${CALENDAR_URL}/${encodeURIComponent(eventId)}`, method: 'DELETE' });
      return Object.freeze({ cancelled: true });
    },

    async health() {
      try {
        await call({ url: CALENDAR_URL, method: 'GET' });
        return { available: true };
      } catch (error) {
        if (isRevoked(error)) return { available: false, reason: 'token_revoked' };
        return { available: false, reason: String(error?.message ?? error) };
      }
    },

    async sync({ cursor, resource }) {
      try {
        if (resource === 'calendar') {
          const url = cursor ? `${CALENDAR_URL}?syncToken=${encodeURIComponent(cursor)}` : CALENDAR_URL;
          const data = await call({ url, method: 'GET' });
          const items = [];
          const removedIds = [];
          for (const raw of data.items ?? []) {
            if (raw.status === 'cancelled') removedIds.push(raw.id);
            else items.push(normalizeEvent(raw));
          }
          return Object.freeze({ items: Object.freeze(items), removedIds: Object.freeze(removedIds), cursor: data.nextSyncToken ?? cursor ?? null, hasMore: false });
        }
        if (resource === 'contacts') {
          const url = cursor
            ? `${PEOPLE_URL}?personFields=names,emailAddresses,phoneNumbers&syncToken=${encodeURIComponent(cursor)}`
            : `${PEOPLE_URL}?personFields=names,emailAddresses,phoneNumbers&requestSyncToken=true`;
          const data = await call({ url, method: 'GET' });
          const items = [];
          const removedIds = [];
          for (const raw of data.connections ?? []) {
            if (raw.metadata?.deleted) removedIds.push(raw.resourceName);
            else items.push(normalizePerson(raw));
          }
          return Object.freeze({ items: Object.freeze(items), removedIds: Object.freeze(removedIds), cursor: data.nextSyncToken ?? cursor ?? null, hasMore: false });
        }
        if (resource === 'tasks') {
          const updatedMin = cursor ?? new Date(0).toISOString();
          const data = await call({ url: `${TASKS_URL}?updatedMin=${encodeURIComponent(updatedMin)}&showHidden=true`, method: 'GET' });
          const items = (data.items ?? []).filter((raw) => !raw.deleted).map(normalizeTask);
          return Object.freeze({ items: Object.freeze(items), removedIds: Object.freeze([]), cursor: new Date(now()).toISOString(), hasMore: false });
        }
        throw new Error('personal_resource_unsupported');
      } catch (error) {
        if (isExpiredSyncToken(error)) throw new Error('personal_sync_resync_required');
        throw error;
      }
    },
  });
}
