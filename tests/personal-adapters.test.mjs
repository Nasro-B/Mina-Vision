import { describe, expect, it, vi } from 'vitest';
import { createGooglePersonalAdapter } from '../src/personal/adapters/google-personal.mjs';
import { createMicrosoftPersonalAdapter } from '../src/personal/adapters/microsoft-personal.mjs';
import { createCaldavCarddavAdapter } from '../src/personal/adapters/caldav-carddav.mjs';

function fakeGoogleOAuth(responder) {
  return { request: vi.fn(async (_credentials, options) => ({ data: responder(options) })) };
}

function fakeMicrosoftOAuth(token = { accessToken: 'tok', tenantId: 't1', username: 'nasro@example.com' }) {
  return { refresh: vi.fn(async () => token) };
}

const credentialsProvider = async () => ({ accessToken: 'a', refreshToken: 'r' });

describe('Task 2 contract: all three adapters expose health/sync with providerId+revision items', () => {
  it('every adapter reports health and returns items carrying providerId and revision', async () => {
    const adapters = [
      createGooglePersonalAdapter({
        oauth: fakeGoogleOAuth((options) => {
          if (options.url.includes('/calendars/primary/events')) {
            return {
              items: [{ id: 'e1', etag: '"g1"', status: 'confirmed', summary: 'RDV', start: { dateTime: '2026-07-20T09:00:00Z' }, end: { dateTime: '2026-07-20T10:00:00Z' } }],
              nextSyncToken: 'sync-2',
            };
          }
          return {};
        }),
        credentialsProvider,
      }),
      createMicrosoftPersonalAdapter({
        oauth: fakeMicrosoftOAuth(),
        credentialsProvider,
        fetchImpl: vi.fn(async () => new Response(JSON.stringify({
          value: [{ id: 'e1', changeKey: 'ck1', subject: 'RDV', start: { dateTime: '2026-07-20T09:00:00.0000000', timeZone: 'UTC' }, end: { dateTime: '2026-07-20T10:00:00.0000000', timeZone: 'UTC' } }],
          '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/me/calendarView/delta?$deltatoken=abc',
        }), { status: 200 })),
      }),
      createCaldavCarddavAdapter({
        fetchImpl: vi.fn(async () => new Response('<xml/>', { status: 207 })),
        xmlParser: { parse: () => ({ responses: [{ href: '/cal/e1.ics', etag: '"c1"', calendarData: 'BEGIN:VEVENT\r\nSUMMARY:RDV\r\nDTSTART:20260720T090000Z\r\nDTEND:20260720T100000Z\r\nUID:e1\r\nEND:VEVENT' }], syncToken: 'sync-token-2' }) },
        baseUrl: 'https://dav.example.test',
        calendarPath: '/cal/',
        contactsPath: '/card/',
        credentials: { username: 'nasro', password: 'x' },
      }),
    ];

    for (const adapter of adapters) {
      // eslint-disable-next-line no-await-in-loop
      expect(await adapter.health()).toMatchObject({ available: true });
      // eslint-disable-next-line no-await-in-loop
      const page = await adapter.sync({ cursor: null, resource: 'calendar' });
      expect(page.items.every((item) => item.providerId && item.revision)).toBe(true);
    }
  });
});

describe('google-personal adapter', () => {
  it('normalizes a calendar event: etag -> revision, dateTime -> startAt/endAt, allDay false', async () => {
    const oauth = fakeGoogleOAuth(() => ({
      items: [{ id: 'e1', etag: '"g1"', status: 'confirmed', summary: 'RDV', start: { dateTime: '2026-07-20T09:00:00Z' }, end: { dateTime: '2026-07-20T10:00:00Z' } }],
      nextSyncToken: 'sync-2',
    }));
    const adapter = createGooglePersonalAdapter({ oauth, credentialsProvider });
    const page = await adapter.sync({ cursor: null, resource: 'calendar' });
    expect(page.items[0]).toMatchObject({ providerId: 'google', revision: '"g1"', title: 'RDV', startAt: '2026-07-20T09:00:00.000Z', allDay: false });
    expect(page.cursor).toBe('sync-2');
  });

  it('normalizes an all-day event from date-only start/end', async () => {
    const oauth = fakeGoogleOAuth(() => ({
      items: [{ id: 'e2', etag: '"g2"', status: 'confirmed', summary: 'Jour férié', start: { date: '2026-07-21' }, end: { date: '2026-07-22' } }],
      nextSyncToken: 'sync-3',
    }));
    const adapter = createGooglePersonalAdapter({ oauth, credentialsProvider });
    const page = await adapter.sync({ cursor: null, resource: 'calendar' });
    expect(page.items[0].allDay).toBe(true);
  });

  it('maps a cancelled event status to a tombstone item (excluded from validated items but reported)', async () => {
    const oauth = fakeGoogleOAuth(() => ({
      items: [{ id: 'e3', etag: '"g3"', status: 'cancelled' }],
      nextSyncToken: 'sync-4',
    }));
    const adapter = createGooglePersonalAdapter({ oauth, credentialsProvider });
    const page = await adapter.sync({ cursor: null, resource: 'calendar' });
    expect(page.items).toEqual([]);
    expect(page.removedIds).toEqual(['e3']);
  });

  it('throws a resync-required error on an expired sync token (410)', async () => {
    const oauth = { request: vi.fn(async () => { const error = new Error('gone'); error.status = 410; throw error; }) };
    const adapter = createGooglePersonalAdapter({ oauth, credentialsProvider });
    await expect(adapter.sync({ cursor: 'stale', resource: 'calendar' })).rejects.toThrow('personal_sync_resync_required');
  });

  it('normalizes a contact: emailAddresses/phoneNumbers -> endpoints', async () => {
    const oauth = fakeGoogleOAuth(() => ({
      connections: [{
        resourceName: 'people/p1', etag: '"pe1"',
        names: [{ displayName: 'Alice' }],
        emailAddresses: [{ value: 'alice@example.com' }],
        phoneNumbers: [{ value: '+33600000000' }],
      }],
      nextSyncToken: 'sync-people-2',
    }));
    const adapter = createGooglePersonalAdapter({ oauth, credentialsProvider });
    const page = await adapter.sync({ cursor: null, resource: 'contacts' });
    expect(page.items[0]).toMatchObject({
      providerId: 'google', revision: '"pe1"', displayName: 'Alice',
      endpoints: [{ channel: 'email', value: 'alice@example.com', verified: true }, { channel: 'phone', value: '+33600000000', verified: true }],
    });
  });

  it('flags a deleted contact via metadata.deleted as a removed id', async () => {
    const oauth = fakeGoogleOAuth(() => ({ connections: [{ resourceName: 'people/p2', metadata: { deleted: true } }], nextSyncToken: 's2' }));
    const adapter = createGooglePersonalAdapter({ oauth, credentialsProvider });
    const page = await adapter.sync({ cursor: null, resource: 'contacts' });
    expect(page.removedIds).toEqual(['people/p2']);
  });

  it('normalizes a task: needsAction -> active, completed -> completed, uses updatedMin-based cursor', async () => {
    const oauth = fakeGoogleOAuth(() => ({ items: [{ id: 'tk1', etag: '"t1"', title: 'Rappeler Alice', status: 'needsAction', due: '2026-07-25T00:00:00.000Z' }] }));
    const adapter = createGooglePersonalAdapter({ oauth, credentialsProvider, clock: () => Date.parse('2026-07-20T00:00:00.000Z') });
    const page = await adapter.sync({ cursor: null, resource: 'tasks' });
    expect(page.items[0]).toMatchObject({ providerId: 'google', revision: '"t1"', status: 'active', dueAt: '2026-07-25T00:00:00.000Z' });
    expect(page.cursor).toBe('2026-07-20T00:00:00.000Z');
  });

  it('creates, completes and cancels Google Tasks with provider receipts', async () => {
    const oauth = fakeGoogleOAuth((options) => {
      if (options.method === 'POST') return { id: 'tk-created', etag: '"r1"' };
      if (options.method === 'PATCH') return { id: 'tk-created', etag: '"r2"' };
      return {};
    });
    const adapter = createGooglePersonalAdapter({ oauth, credentialsProvider });

    await expect(adapter.create({ title: 'Rappeler Alice', dueAt: '2026-07-25T00:00:00.000Z' }))
      .resolves.toEqual({ taskId: 'tk-created', revision: '"r1"' });
    await expect(adapter.complete('tk-created')).resolves.toEqual({ revision: '"r2"' });
    await expect(adapter.cancel('tk-created')).resolves.toEqual({ cancelled: true });
    expect(oauth.request.mock.calls.map(([, options]) => options.method)).toEqual(['POST', 'PATCH', 'DELETE']);
  });

  it('reports health unavailable when the token has been revoked', async () => {
    const oauth = { request: vi.fn(async () => { const error = new Error('invalid_grant'); error.status = 401; throw error; }) };
    const adapter = createGooglePersonalAdapter({ oauth, credentialsProvider });
    expect(await adapter.health()).toEqual({ available: false, reason: 'token_revoked' });
  });

  it('rejects an unsupported resource', async () => {
    const adapter = createGooglePersonalAdapter({ oauth: fakeGoogleOAuth(() => ({})), credentialsProvider });
    await expect(adapter.sync({ cursor: null, resource: 'notes' })).rejects.toThrow('personal_resource_unsupported');
  });

  it('creates a calendar event and returns provider-shaped normalized event via getEvent', async () => {
    const oauth = fakeGoogleOAuth((options) => {
      if (options.method === 'POST') return { id: 'e-created', etag: '"ce1"' };
      if (options.method === 'GET') {
        return { id: 'e-created', etag: '"ce1"', status: 'confirmed', summary: 'RDV dentiste', start: { dateTime: '2026-07-25T09:00:00Z' }, end: { dateTime: '2026-07-25T10:00:00Z' } };
      }
      throw new Error(`unexpected method ${options.method}`);
    });
    const adapter = createGooglePersonalAdapter({ oauth, credentialsProvider });

    const receipt = await adapter.createEvent({ title: 'RDV dentiste', startAt: '2026-07-25T09:00:00.000Z', endAt: '2026-07-25T10:00:00.000Z' });
    expect(receipt).toEqual({ eventId: 'e-created', revision: '"ce1"' });
    const verified = await adapter.getEvent('e-created');
    expect(verified).toMatchObject({ providerId: 'google', title: 'RDV dentiste' });
  });

  it('rejects creating a calendar event with a missing title or invalid time range', async () => {
    const adapter = createGooglePersonalAdapter({ oauth: fakeGoogleOAuth(() => ({})), credentialsProvider });
    await expect(adapter.createEvent({ title: '', startAt: '2026-07-25T09:00:00.000Z', endAt: '2026-07-25T10:00:00.000Z' }))
      .rejects.toThrow('google_event_title_invalid');
    await expect(adapter.createEvent({ title: 'x', startAt: '2026-07-25T10:00:00.000Z', endAt: '2026-07-25T09:00:00.000Z' }))
      .rejects.toThrow('google_event_time_range_invalid');
  });

  it('updates a calendar event with the raw patch fields Google expects', async () => {
    const oauth = fakeGoogleOAuth((options) => {
      if (options.method === 'PATCH') return { id: 'e1', etag: '"ce2"' };
      throw new Error(`unexpected method ${options.method}`);
    });
    const adapter = createGooglePersonalAdapter({ oauth, credentialsProvider });
    await expect(adapter.updateEvent({ eventId: 'e1', patch: { title: 'RDV reporté' } })).resolves.toEqual({ revision: '"ce2"' });
    expect(oauth.request.mock.calls[0][1].data).toEqual({ summary: 'RDV reporté' });
  });

  it('cancels a calendar event via DELETE', async () => {
    const oauth = fakeGoogleOAuth((options) => {
      if (options.method === 'DELETE') return {};
      throw new Error(`unexpected method ${options.method}`);
    });
    const adapter = createGooglePersonalAdapter({ oauth, credentialsProvider });
    await expect(adapter.cancelEvent('e1')).resolves.toEqual({ cancelled: true });
  });
});

describe('microsoft-personal adapter', () => {
  it('normalizes a calendar event: changeKey -> revision, uses @odata.deltaLink as next cursor', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      value: [{ id: 'e1', changeKey: 'ck1', subject: 'RDV', start: { dateTime: '2026-07-20T09:00:00.0000000', timeZone: 'UTC' }, end: { dateTime: '2026-07-20T10:00:00.0000000', timeZone: 'UTC' } }],
      '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/me/calendarView/delta?$deltatoken=abc',
    }), { status: 200 }));
    const adapter = createMicrosoftPersonalAdapter({ oauth: fakeMicrosoftOAuth(), credentialsProvider, fetchImpl });
    const page = await adapter.sync({ cursor: null, resource: 'calendar' });
    expect(page.items[0]).toMatchObject({ providerId: 'microsoft', revision: 'ck1', title: 'RDV', startAt: '2026-07-20T09:00:00.000Z' });
    expect(page.cursor).toBe('https://graph.microsoft.com/v1.0/me/calendarView/delta?$deltatoken=abc');
    expect(page.hasMore).toBe(false);
  });

  it('follows @odata.nextLink and reports hasMore true', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      value: [],
      '@odata.nextLink': 'https://graph.microsoft.com/v1.0/me/calendarView/delta?$skiptoken=xyz',
    }), { status: 200 }));
    const adapter = createMicrosoftPersonalAdapter({ oauth: fakeMicrosoftOAuth(), credentialsProvider, fetchImpl });
    const page = await adapter.sync({ cursor: null, resource: 'calendar' });
    expect(page.hasMore).toBe(true);
    expect(page.cursor).toBe('https://graph.microsoft.com/v1.0/me/calendarView/delta?$skiptoken=xyz');
  });

  it('maps an @removed deleted event to a removedId, excluded from items', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      value: [{ id: 'e-gone', '@removed': { reason: 'deleted' } }],
      '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/me/calendarView/delta?$deltatoken=next',
    }), { status: 200 }));
    const adapter = createMicrosoftPersonalAdapter({ oauth: fakeMicrosoftOAuth(), credentialsProvider, fetchImpl });
    const page = await adapter.sync({ cursor: null, resource: 'calendar' });
    expect(page.items).toEqual([]);
    expect(page.removedIds).toEqual(['e-gone']);
  });

  it('throws resync-required on 410 Gone (expired delta token)', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 410 }));
    const adapter = createMicrosoftPersonalAdapter({ oauth: fakeMicrosoftOAuth(), credentialsProvider, fetchImpl });
    await expect(adapter.sync({ cursor: 'stale-delta-link', resource: 'calendar' })).rejects.toThrow('personal_sync_resync_required');
  });

  it('retries once on a 429 throttling response honoring Retry-After, then succeeds', async () => {
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call += 1;
      if (call === 1) return new Response('', { status: 429, headers: { 'Retry-After': '0' } });
      return new Response(JSON.stringify({ value: [], '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/x?$deltatoken=t' }), { status: 200 });
    });
    const adapter = createMicrosoftPersonalAdapter({ oauth: fakeMicrosoftOAuth(), credentialsProvider, fetchImpl, wait: vi.fn(async () => {}) });
    const page = await adapter.sync({ cursor: null, resource: 'calendar' });
    expect(page.items).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('resolves the default contact folder before delta-syncing contacts (documented endpoint, not /me/contacts/delta)', async () => {
    const calls = [];
    const fetchImpl = vi.fn(async (url) => {
      calls.push(String(url));
      if (String(url).includes('/me/contactFolders') && !String(url).includes('/contacts/delta')) {
        return new Response(JSON.stringify({ value: [{ id: 'folder-1', displayName: 'Contacts' }] }), { status: 200 });
      }
      return new Response(JSON.stringify({
        value: [{ id: 'c1', changeKey: 'cck1', displayName: 'Alice', emailAddresses: [{ address: 'alice@example.com' }] }],
        '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/x?$deltatoken=c2',
      }), { status: 200 });
    });
    const adapter = createMicrosoftPersonalAdapter({ oauth: fakeMicrosoftOAuth(), credentialsProvider, fetchImpl });
    const page = await adapter.sync({ cursor: null, resource: 'contacts' });
    expect(calls[0]).toContain('/me/contactFolders');
    expect(calls.at(-1)).toContain('folder-1/contacts/delta');
    expect(page.items[0]).toMatchObject({ providerId: 'microsoft', revision: 'cck1', displayName: 'Alice' });
  });

  it('normalizes a todo task: status mapping and dueDateTime', async () => {
    const fetchImpl = vi.fn(async (url) => {
      if (String(url).includes('/todo/lists/delta')) {
        return new Response(JSON.stringify({ value: [{ id: 'list-1', displayName: 'Tasks' }] }), { status: 200 });
      }
      return new Response(JSON.stringify({
        value: [{ id: 'tk1', lastModifiedDateTime: '2026-07-20T00:00:00Z', title: 'Rappeler Alice', status: 'notStarted', dueDateTime: { dateTime: '2026-07-25T00:00:00.0000000', timeZone: 'UTC' } }],
        '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/x?$deltatoken=t2',
      }), { status: 200 });
    });
    const adapter = createMicrosoftPersonalAdapter({ oauth: fakeMicrosoftOAuth(), credentialsProvider, fetchImpl });
    const page = await adapter.sync({ cursor: null, resource: 'tasks' });
    expect(page.items[0]).toMatchObject({ providerId: 'microsoft', status: 'active', title: 'Rappeler Alice' });
  });

  it('reports health unavailable on a token/tenant mismatch', async () => {
    const oauth = { refresh: vi.fn(async () => { throw new Error('invalid_grant'); }) };
    const adapter = createMicrosoftPersonalAdapter({ oauth, credentialsProvider, fetchImpl: vi.fn() });
    expect(await adapter.health()).toEqual({ available: false, reason: 'token_revoked' });
  });
});

describe('caldav-carddav adapter (RFC 6578 sync-collection)', () => {
  function buildAdapter({ fetchImpl, xmlParser }) {
    return createCaldavCarddavAdapter({
      fetchImpl, xmlParser, baseUrl: 'https://dav.example.test', calendarPath: '/cal/', contactsPath: '/card/',
      credentials: { username: 'nasro', password: 'secret' },
    });
  }

  it('sends a sync-collection REPORT with the Basic auth header and the previous sync-token', async () => {
    const fetchImpl = vi.fn(async (url, options) => {
      expect(options.method).toBe('REPORT');
      expect(options.headers.Authorization).toMatch(/^Basic /u);
      expect(options.body).toContain('stale-token');
      return new Response('<xml/>', { status: 207 });
    });
    const xmlParser = { parse: () => ({ responses: [], syncToken: 'new-token' }) };
    const adapter = buildAdapter({ fetchImpl, xmlParser });
    await adapter.sync({ cursor: 'stale-token', resource: 'calendar' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('normalizes a VEVENT response: etag -> revision, DTSTART/DTEND -> startAt/endAt', async () => {
    const xmlParser = {
      parse: () => ({
        responses: [{ href: '/cal/e1.ics', etag: '"c1"', calendarData: 'BEGIN:VEVENT\r\nUID:e1\r\nSUMMARY:RDV\r\nDTSTART:20260720T090000Z\r\nDTEND:20260720T100000Z\r\nEND:VEVENT' }],
        syncToken: 'sync-2',
      }),
    };
    const adapter = buildAdapter({ fetchImpl: vi.fn(async () => new Response('<xml/>', { status: 207 })), xmlParser });
    const page = await adapter.sync({ cursor: null, resource: 'calendar' });
    expect(page.items[0]).toMatchObject({ providerId: 'caldav-carddav', revision: '"c1"', title: 'RDV', startAt: '2026-07-20T09:00:00.000Z', endAt: '2026-07-20T10:00:00.000Z' });
    expect(page.cursor).toBe('sync-2');
  });

  it('normalizes a VCARD response using the UID for identity', async () => {
    const xmlParser = {
      parse: () => ({
        responses: [{ href: '/card/p1.vcf', etag: '"vc1"', addressData: 'BEGIN:VCARD\r\nUID:p1\r\nFN:Alice\r\nEMAIL:alice@example.com\r\nEND:VCARD' }],
        syncToken: 'sync-card-2',
      }),
    };
    const adapter = buildAdapter({ fetchImpl: vi.fn(async () => new Response('<xml/>', { status: 207 })), xmlParser });
    const page = await adapter.sync({ cursor: null, resource: 'contacts' });
    expect(page.items[0]).toMatchObject({ providerId: 'caldav-carddav', revision: '"vc1"', displayName: 'Alice', endpoints: [{ channel: 'email', value: 'alice@example.com', verified: true }] });
  });

  it('treats a 404/removed href as a tombstone (removedIds)', async () => {
    const xmlParser = { parse: () => ({ responses: [{ href: '/cal/e2.ics', status: '404 Not Found' }], syncToken: 'sync-3' }) };
    const adapter = buildAdapter({ fetchImpl: vi.fn(async () => new Response('<xml/>', { status: 207 })), xmlParser });
    const page = await adapter.sync({ cursor: null, resource: 'calendar' });
    expect(page.removedIds).toEqual(['/cal/e2.ics']);
  });

  it('throws resync-required on 403 (sync-token no longer valid per RFC 6578)', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 403 }));
    const adapter = buildAdapter({ fetchImpl, xmlParser: { parse: vi.fn() } });
    await expect(adapter.sync({ cursor: 'stale', resource: 'calendar' })).rejects.toThrow('personal_sync_resync_required');
  });

  it('rejects the tasks resource: not supported by this adapter', async () => {
    const adapter = buildAdapter({ fetchImpl: vi.fn(), xmlParser: { parse: vi.fn() } });
    await expect(adapter.sync({ cursor: null, resource: 'tasks' })).rejects.toThrow('personal_resource_unsupported');
  });

  it('fails closed on a TLS/network failure rather than silently returning an empty page', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('self_signed_certificate'); });
    const adapter = buildAdapter({ fetchImpl, xmlParser: { parse: vi.fn() } });
    await expect(adapter.sync({ cursor: null, resource: 'calendar' })).rejects.toThrow('self_signed_certificate');
  });

  it('reports health by issuing a PROPFIND against the calendar collection', async () => {
    const fetchImpl = vi.fn(async (_url, options) => {
      expect(options.method).toBe('PROPFIND');
      return new Response('<xml/>', { status: 207 });
    });
    const adapter = buildAdapter({ fetchImpl, xmlParser: { parse: () => ({}) } });
    expect(await adapter.health()).toEqual({ available: true });
  });

  it('reports health unavailable on an authentication failure', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 401 }));
    const adapter = buildAdapter({ fetchImpl, xmlParser: { parse: () => ({}) } });
    expect(await adapter.health()).toEqual({ available: false, reason: 'authentication_failed' });
  });
});
