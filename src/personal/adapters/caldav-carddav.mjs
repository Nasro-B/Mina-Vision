import { validateCalendarEvent, validatePerson } from '../personal-contracts.mjs';

function icsField(text, name) {
  const match = new RegExp(`${name}:([^\r\n]+)`, 'u').exec(text);
  return match ? match[1] : null;
}

function icsDate(value) {
  if (!value) return null;
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/u.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second))).toISOString();
}

function normalizeVevent(response) {
  const text = response.calendarData ?? '';
  const startAt = icsDate(icsField(text, 'DTSTART'));
  const endAt = icsDate(icsField(text, 'DTEND'));
  return validateCalendarEvent({
    eventId: icsField(text, 'UID') ?? response.href,
    providerId: 'caldav-carddav',
    calendarId: 'default',
    title: icsField(text, 'SUMMARY') ?? '(sans titre)',
    startAt,
    endAt,
    allDay: false,
    revision: response.etag,
  });
}

function vcardField(text, name) {
  const match = new RegExp(`${name}:([^\r\n]+)`, 'u').exec(text);
  return match ? match[1] : null;
}

function normalizeVcard(response) {
  const text = response.addressData ?? '';
  const email = vcardField(text, 'EMAIL');
  return validatePerson({
    personId: vcardField(text, 'UID') ?? response.href,
    providerId: 'caldav-carddav',
    displayName: vcardField(text, 'FN') ?? '(sans nom)',
    endpoints: email ? [{ channel: 'email', value: email, verified: true }] : [],
    revision: response.etag,
  });
}

function syncCollectionBody(cursor) {
  return `<?xml version="1.0" encoding="utf-8" ?>
<d:sync-collection xmlns:d="DAV:">
  <d:sync-token>${cursor ?? ''}</d:sync-token>
  <d:sync-level>1</d:sync-level>
  <d:prop><d:getetag/><d:getcontenttype/></d:prop>
</d:sync-collection>`;
}

export function createCaldavCarddavAdapter({
  fetchImpl = fetch, xmlParser, baseUrl, calendarPath = '/cal/', contactsPath = '/card/', credentials,
} = {}) {
  if (!xmlParser?.parse) throw new TypeError('caldav_carddav_xml_parser_required');
  if (typeof baseUrl !== 'string' || baseUrl.length === 0) throw new TypeError('caldav_carddav_base_url_required');
  if (!credentials?.username || !credentials?.password) throw new TypeError('caldav_carddav_credentials_required');

  const authHeader = `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64')}`;

  async function report(path, cursor) {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      method: 'REPORT',
      headers: { Authorization: authHeader, 'Content-Type': 'application/xml; charset=utf-8', Depth: '1' },
      body: syncCollectionBody(cursor),
    });
    if (response.status === 403 || response.status === 409) throw new Error('personal_sync_resync_required');
    if (response.status === 401) throw new Error('caldav_carddav_authentication_failed');
    if (response.status !== 207) throw new Error(`caldav_carddav_report_failed:${response.status}`);
    const text = await response.text();
    return xmlParser.parse(text);
  }

  return Object.freeze({
    id: 'caldav-carddav',

    async health() {
      try {
        const response = await fetchImpl(`${baseUrl}${calendarPath}`, { method: 'PROPFIND', headers: { Authorization: authHeader, Depth: '0' } });
        if (response.status === 401) return { available: false, reason: 'authentication_failed' };
        if (response.status !== 207) return { available: false, reason: `unexpected_status:${response.status}` };
        return { available: true };
      } catch (error) {
        return { available: false, reason: String(error?.message ?? error) };
      }
    },

    async sync({ cursor, resource }) {
      if (resource === 'calendar') {
        const parsed = await report(calendarPath, cursor);
        const items = [];
        const removedIds = [];
        for (const entry of parsed.responses ?? []) {
          if (entry.status?.includes('404')) removedIds.push(entry.href);
          else items.push(normalizeVevent(entry));
        }
        return Object.freeze({ items: Object.freeze(items), removedIds: Object.freeze(removedIds), cursor: parsed.syncToken ?? cursor ?? null, hasMore: false });
      }
      if (resource === 'contacts') {
        const parsed = await report(contactsPath, cursor);
        const items = [];
        const removedIds = [];
        for (const entry of parsed.responses ?? []) {
          if (entry.status?.includes('404')) removedIds.push(entry.href);
          else items.push(normalizeVcard(entry));
        }
        return Object.freeze({ items: Object.freeze(items), removedIds: Object.freeze(removedIds), cursor: parsed.syncToken ?? cursor ?? null, hasMore: false });
      }
      throw new Error('personal_resource_unsupported');
    },
  });
}
