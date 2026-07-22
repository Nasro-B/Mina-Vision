import { validateCalendarEvent, validatePerson, validateTask } from '../personal-contracts.mjs';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const MAX_THROTTLE_RETRIES = 3;
const DEFAULT_WINDOW_MS = { past: 30 * 24 * 60 * 60 * 1000, future: 180 * 24 * 60 * 60 * 1000 };

async function parseJson(response) {
  const text = await response.text();
  return text.length > 0 ? JSON.parse(text) : {};
}

function normalizeEvent(raw) {
  return validateCalendarEvent({
    eventId: raw.id,
    providerId: 'microsoft',
    calendarId: 'primary',
    title: raw.subject ?? '(sans titre)',
    description: raw.bodyPreview ?? '',
    location: raw.location?.displayName ?? '',
    startAt: new Date(`${raw.start.dateTime}Z`.replace('ZZ', 'Z')).toISOString(),
    endAt: new Date(`${raw.end.dateTime}Z`.replace('ZZ', 'Z')).toISOString(),
    allDay: Boolean(raw.isAllDay),
    attendees: (raw.attendees ?? []).map((attendee) => ({
      email: attendee.emailAddress?.address,
      responseStatus: attendee.status?.response === 'organizer' ? 'accepted' : (attendee.status?.response ?? 'needsAction'),
    })),
    revision: raw.changeKey,
  });
}

function normalizeContact(raw) {
  const endpoints = [
    ...(raw.emailAddresses ?? []).map((entry) => ({ channel: 'email', value: entry.address, verified: true })),
    ...(raw.businessPhones ?? []).map((value) => ({ channel: 'phone', value, verified: true })),
  ];
  return validatePerson({
    personId: raw.id,
    providerId: 'microsoft',
    displayName: raw.displayName ?? '(sans nom)',
    endpoints,
    revision: raw.changeKey,
  });
}

const TODO_STATUS = new Set(['completed']);

function normalizeTask(raw) {
  return validateTask({
    taskId: raw.id,
    providerId: 'microsoft',
    title: raw.title ?? '(sans titre)',
    status: TODO_STATUS.has(raw.status) ? 'completed' : 'active',
    dueAt: raw.dueDateTime ? new Date(`${raw.dueDateTime.dateTime}Z`.replace('ZZ', 'Z')).toISOString() : null,
    sourceRef: null,
    revision: raw.lastModifiedDateTime ?? String(raw.id),
  });
}

export function createMicrosoftPersonalAdapter({
  oauth, credentialsProvider, fetchImpl = fetch, wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  if (!oauth?.refresh) throw new TypeError('microsoft_personal_oauth_required');
  if (typeof credentialsProvider !== 'function') throw new TypeError('microsoft_personal_credentials_provider_required');

  async function call(url, { method = 'GET' } = {}, attempt = 0) {
    const credentials = await credentialsProvider();
    const token = await oauth.refresh({ refreshToken: credentials.refreshToken });
    const response = await fetchImpl(url, { method, headers: { Authorization: `Bearer ${token.accessToken}`, 'Content-Type': 'application/json' } });
    if (response.status === 429 && attempt < MAX_THROTTLE_RETRIES) {
      const retryAfterMs = Number(response.headers?.get?.('Retry-After') ?? 1) * 1000;
      await wait(retryAfterMs);
      return call(url, { method }, attempt + 1);
    }
    if (response.status === 410) throw new Error('personal_sync_resync_required');
    if (!response.ok) {
      const error = new Error(`microsoft_personal_request_failed:${response.status}`);
      error.status = response.status;
      throw error;
    }
    return parseJson(response);
  }

  async function followDelta(initialUrl) {
    const data = await call(initialUrl);
    const items = [];
    const removedIds = [];
    for (const raw of data.value ?? []) {
      if (raw['@removed']) removedIds.push(raw.id);
      else items.push(raw);
    }
    const nextLink = data['@odata.nextLink'] ?? null;
    const deltaLink = data['@odata.deltaLink'] ?? null;
    return { items, removedIds, cursor: nextLink ?? deltaLink, hasMore: Boolean(nextLink) };
  }

  return Object.freeze({
    id: 'microsoft',

    async health() {
      try {
        await call(`${GRAPH_BASE}/me`);
        return { available: true };
      } catch (error) {
        if (error.status === 401 || /invalid_grant/u.test(error.message ?? '')) return { available: false, reason: 'token_revoked' };
        return { available: false, reason: String(error?.message ?? error) };
      }
    },

    async sync({ cursor, resource }) {
      if (resource === 'calendar') {
        const url = cursor ?? (() => {
          const start = new Date(Date.now() - DEFAULT_WINDOW_MS.past).toISOString();
          const end = new Date(Date.now() + DEFAULT_WINDOW_MS.future).toISOString();
          return `${GRAPH_BASE}/me/calendarView/delta?startDateTime=${encodeURIComponent(start)}&endDateTime=${encodeURIComponent(end)}`;
        })();
        const page = await followDelta(url);
        return Object.freeze({
          items: Object.freeze(page.items.map(normalizeEvent)),
          removedIds: Object.freeze(page.removedIds),
          cursor: page.cursor,
          hasMore: page.hasMore,
        });
      }
      if (resource === 'contacts') {
        let url = cursor;
        if (!url) {
          const folders = await call(`${GRAPH_BASE}/me/contactFolders`);
          const folderId = folders.value?.[0]?.id;
          if (!folderId) throw new Error('microsoft_personal_contact_folder_not_found');
          url = `${GRAPH_BASE}/me/contactFolders/${folderId}/contacts/delta`;
        }
        const page = await followDelta(url);
        return Object.freeze({
          items: Object.freeze(page.items.map(normalizeContact)),
          removedIds: Object.freeze(page.removedIds),
          cursor: page.cursor,
          hasMore: page.hasMore,
        });
      }
      if (resource === 'tasks') {
        let url = cursor;
        if (!url) {
          const lists = await call(`${GRAPH_BASE}/me/todo/lists/delta`);
          const listId = lists.value?.[0]?.id;
          if (!listId) throw new Error('microsoft_personal_task_list_not_found');
          url = `${GRAPH_BASE}/me/todo/lists/${listId}/tasks/delta`;
        }
        const page = await followDelta(url);
        return Object.freeze({
          items: Object.freeze(page.items.map(normalizeTask)),
          removedIds: Object.freeze(page.removedIds),
          cursor: page.cursor,
          hasMore: page.hasMore,
        });
      }
      throw new Error('personal_resource_unsupported');
    },
  });
}
