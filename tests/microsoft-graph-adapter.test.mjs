import { describe, expect, it, vi } from 'vitest';
import { createMicrosoftOAuthClient } from '../src/mail/oauth/microsoft-oauth.mjs';
import { createMicrosoftGraphAdapter } from '../src/mail/adapters/microsoft-graph.mjs';

function authResult(overrides = {}) {
  return {
    accessToken: 'access-1', expiresOn: new Date('2026-07-16T00:00:00Z'),
    account: { tenantId: 'tenant-1', username: 'nasro@work.test' }, ...overrides,
  };
}

describe('Microsoft OAuth client: device code and interactive flows', () => {
  it('requests a device code with a visible user callback, never silently', async () => {
    const deviceCodeCallback = vi.fn();
    const fakeApp = { acquireTokenByDeviceCode: vi.fn(async ({ deviceCodeCallback: cb }) => { cb({ userCode: '123-ABC', verificationUri: 'https://microsoft.com/devicelogin' }); return authResult(); }) };
    const oauth = await createMicrosoftOAuthClient({
      clientId: 'client-1', importPublicClientApplication: async () => function PublicClientApplication() { return fakeApp; },
    });
    const result = await oauth.requestDeviceCode(['Mail.ReadWrite'], deviceCodeCallback);
    expect(deviceCodeCallback).toHaveBeenCalledWith(expect.objectContaining({ userCode: '123-ABC' }));
    expect(result).toEqual({ accessToken: 'access-1', expiresOn: '2026-07-16T00:00:00.000Z', tenantId: 'tenant-1', username: 'nasro@work.test' });
  });

  it('builds an interactive authorization URL and exchanges the returned code', async () => {
    const fakeApp = {
      getAuthCodeUrl: vi.fn(async () => 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize?...'),
      acquireTokenByCode: vi.fn(async () => authResult()),
    };
    const oauth = await createMicrosoftOAuthClient({
      clientId: 'client-1', importPublicClientApplication: async () => function PublicClientApplication() { return fakeApp; },
    });
    await expect(oauth.getAuthCodeUrl(['Mail.ReadWrite'], 'http://localhost/callback')).resolves.toContain('authorize');
    await expect(oauth.exchangeCode({ code: 'auth-code-1', scopes: ['Mail.ReadWrite'], redirectUri: 'http://localhost/callback' }))
      .resolves.toMatchObject({ tenantId: 'tenant-1', username: 'nasro@work.test' });
  });

  it('rejects an OAuth result missing tenant or username instead of trusting a malformed token', async () => {
    const fakeApp = { acquireTokenByRefreshToken: vi.fn(async () => ({ accessToken: 'a' })) };
    const oauth = await createMicrosoftOAuthClient({
      clientId: 'client-1', importPublicClientApplication: async () => function PublicClientApplication() { return fakeApp; },
    });
    await expect(oauth.refresh({ refreshToken: 'r1' })).rejects.toThrow('microsoft_oauth_result_invalid');
  });
});

function normalizedToken(overrides = {}) {
  return { accessToken: 'access-1', expiresOn: '2026-07-16T00:00:00.000Z', tenantId: 'tenant-1', username: 'nasro@work.test', ...overrides };
}

function fakeGraphOauth(tokenOverrides = {}) {
  return { refresh: vi.fn(async () => normalizedToken(tokenOverrides)) };
}

function jsonResponse(status, body, headers = {}) {
  return {
    status,
    headers: { get: (name) => headers[name] ?? null },
    text: async () => JSON.stringify(body ?? {}),
  };
}

function bytesResponse(status, bytes, headers = {}) {
  return {
    status,
    headers: { get: (name) => headers[name] ?? null },
    text: async () => '',
    arrayBuffer: async () => Uint8Array.from(bytes).buffer,
  };
}

const account = Object.freeze({ id: 'work-graph', address: 'nasro@work.test' });
const credentialsProvider = async () => ({ refreshToken: 'refresh-1', scopes: ['Mail.ReadWrite'] });

describe('Microsoft Graph adapter: identity validation and folders', () => {
  it('rejects a token whose account does not match the locally confirmed mailbox', async () => {
    const adapter = createMicrosoftGraphAdapter({
      account, oauth: fakeGraphOauth({ username: 'someone-else@work.test' }),
      fetchImpl: vi.fn(),
    });
    await expect(adapter.listFolders({ credentialsProvider })).rejects.toThrow('microsoft_account_mismatch');
  });

  it('rejects a token from an unexpected tenant when a tenant is pinned', async () => {
    const adapter = createMicrosoftGraphAdapter({
      account, requiredTenantId: 'expected-tenant', oauth: fakeGraphOauth(), fetchImpl: vi.fn(),
    });
    await expect(adapter.listFolders({ credentialsProvider })).rejects.toThrow('microsoft_tenant_mismatch');
  });

  it('lists folders with id, display name, and unread count', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { value: [{ id: 'f1', displayName: 'Inbox', unreadItemCount: 3 }] }));
    const adapter = createMicrosoftGraphAdapter({ account, oauth: fakeGraphOauth(), fetchImpl });
    await expect(adapter.listFolders({ credentialsProvider })).resolves.toEqual([{ id: 'f1', displayName: 'Inbox', unreadItemCount: 3 }]);
    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe('Bearer access-1');
  });
});

describe('Microsoft Graph adapter: delta sync and expired cursor', () => {
  it('performs a full delta sync and returns the deltaLink cursor to persist', async () => {
    const persisted = [];
    const fetchImpl = vi.fn(async () => jsonResponse(200, {
      value: [{ id: 'm1', internetMessageId: '<m1@work.test>', subject: 'Bonjour', receivedDateTime: '2026-07-16T00:00:00Z', body: { content: 'Contenu' } }],
      '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$deltatoken=abc',
    }));
    const adapter = createMicrosoftGraphAdapter({ account, oauth: fakeGraphOauth(), fetchImpl });

    const result = await adapter.sync({ credentialsProvider, persist: async (message) => persisted.push(message) });
    expect(result).toEqual({ deltaLink: 'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$deltatoken=abc', imported: 1, resynced: true });
    expect(persisted[0]).toMatchObject({ providerMessageId: 'm1', internetMessageId: '<m1@work.test>', trust: 'external_untrusted' });
  });

  it('continues an incremental sync from a saved deltaLink cursor', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, {
      value: [{ id: 'm2', subject: 'Suite' }],
      '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$deltatoken=def',
    }));
    const adapter = createMicrosoftGraphAdapter({ account, oauth: fakeGraphOauth(), fetchImpl });

    const result = await adapter.sync({
      credentialsProvider, cursor: { deltaLink: 'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$deltatoken=abc' },
      persist: async () => {},
    });
    expect(result.resynced).toBe(false);
    expect(fetchImpl).toHaveBeenCalledWith('https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$deltatoken=abc', expect.anything());
  });

  it('restarts with a full resync when Graph returns 410 resyncRequired for an expired delta token', async () => {
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call += 1;
      if (call === 1) return jsonResponse(410, { error: { code: 'resyncRequired' } });
      return jsonResponse(200, { value: [{ id: 'm3' }], '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/.../delta?$deltatoken=new' });
    });
    const adapter = createMicrosoftGraphAdapter({ account, oauth: fakeGraphOauth(), fetchImpl });

    const result = await adapter.sync({
      credentialsProvider, cursor: { deltaLink: 'https://graph.microsoft.com/v1.0/.../delta?$deltatoken=stale' }, persist: async () => {},
    });
    expect(result.resynced).toBe(true);
    expect(result.deltaLink).toContain('new');
  });
});

describe('Microsoft Graph adapter: attachment ingestion', () => {
  it('skips a deleted delta item without querying its attachments', async () => {
    const fetchImpl = vi.fn(async (url) => {
      if (url.includes('$deltatoken=abc')) {
        return jsonResponse(200, {
          value: [{ id: 'deleted-message', '@removed': { reason: 'deleted' } }],
          '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$deltatoken=def',
        });
      }
      if (url.includes('/attachments')) throw new Error('graph_attachment_fetch_should_not_run');
      throw new Error(`unexpected_url:${url}`);
    });
    const adapter = createMicrosoftGraphAdapter({ account, oauth: fakeGraphOauth(), fetchImpl });
    const persist = vi.fn();

    const result = await adapter.sync({
      credentialsProvider,
      cursor: { deltaLink: 'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$deltatoken=abc' },
      persist,
    });

    expect(result).toEqual(expect.objectContaining({ imported: 0, resynced: false }));
    expect(persist).not.toHaveBeenCalled();
  });

  it('persists only bounded file attachments and never dereferences a reference attachment', async () => {
    const bytes = Buffer.from('%PDF-1.7 graph attachment', 'utf8');
    const persisted = [];
    const fetchImpl = vi.fn(async (url) => {
      if (url.endsWith('/mailFolders/inbox/messages/delta')) {
        return jsonResponse(200, {
          value: [{ id: 'm1', internetMessageId: '<m1@work.test>', subject: 'Bonjour', body: { content: 'Contenu' } }],
          '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$deltatoken=abc',
        });
      }
      if (url.endsWith('/messages/m1/attachments')) {
        return jsonResponse(200, {
          value: [
            { '@odata.type': '#microsoft.graph.fileAttachment', id: 'a1', name: 'devis.pdf', contentType: 'application/pdf', size: bytes.length },
            { '@odata.type': '#microsoft.graph.referenceAttachment', id: 'r1', name: 'partage', sourceUrl: 'https://external.example.test/file' },
          ],
        });
      }
      if (url.endsWith('/messages/m1/attachments/a1/$value')) {
        return bytesResponse(200, bytes, { 'Content-Length': String(bytes.length) });
      }
      throw new Error(`unexpected_url:${url}`);
    });
    const adapter = createMicrosoftGraphAdapter({ account, oauth: fakeGraphOauth(), fetchImpl });

    await adapter.sync({ credentialsProvider, persist: async (message) => persisted.push(message) });

    expect(persisted).toEqual([expect.objectContaining({
      attachments: [expect.objectContaining({
        filename: 'devis.pdf', contentType: 'application/pdf', bytes,
      })],
    })]);
  });

  it('rejects a Graph attachment declared above the quarantine bound before reading raw bytes', async () => {
    const fetchImpl = vi.fn(async (url) => {
      if (url.endsWith('/mailFolders/inbox/messages/delta')) {
        return jsonResponse(200, {
          value: [{ id: 'm1', internetMessageId: '<m1@work.test>', subject: 'Bonjour', body: { content: 'Contenu' } }],
          '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$deltatoken=abc',
        });
      }
      if (url.endsWith('/messages/m1/attachments')) {
        return jsonResponse(200, {
          value: [{ '@odata.type': '#microsoft.graph.fileAttachment', id: 'a1', name: 'trop-gros.pdf', contentType: 'application/pdf', size: 26 * 1024 * 1024 }],
        });
      }
      if (url.endsWith('/$value')) throw new Error('graph_attachment_fetch_should_not_run');
      throw new Error(`unexpected_url:${url}`);
    });
    const adapter = createMicrosoftGraphAdapter({ account, oauth: fakeGraphOauth(), fetchImpl });

    await expect(adapter.sync({ credentialsProvider, persist: async () => {} })).rejects.toThrow('microsoft_attachment_too_large');
  });

  it('rejects an oversized Graph payload header before reading its body', async () => {
    const arrayBuffer = vi.fn(async () => Uint8Array.from([1]).buffer);
    const fetchImpl = vi.fn(async (url) => {
      if (url.endsWith('/mailFolders/inbox/messages/delta')) {
        return jsonResponse(200, {
          value: [{ id: 'm1', internetMessageId: '<m1@work.test>', subject: 'Bonjour', body: { content: 'Contenu' } }],
          '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$deltatoken=abc',
        });
      }
      if (url.endsWith('/messages/m1/attachments')) {
        return jsonResponse(200, {
          value: [{ '@odata.type': '#microsoft.graph.fileAttachment', id: 'a1', name: 'devis.pdf', contentType: 'application/pdf', size: 1 }],
        });
      }
      if (url.endsWith('/messages/m1/attachments/a1/$value')) {
        return {
          status: 200,
          headers: { get: (name) => (name === 'Content-Length' ? String(26 * 1024 * 1024) : null) },
          arrayBuffer,
        };
      }
      throw new Error(`unexpected_url:${url}`);
    });
    const adapter = createMicrosoftGraphAdapter({ account, oauth: fakeGraphOauth(), fetchImpl });

    await expect(adapter.sync({ credentialsProvider, persist: async () => {} })).rejects.toThrow('microsoft_attachment_too_large');
    expect(arrayBuffer).not.toHaveBeenCalled();
  });
});

describe('Microsoft Graph adapter: throttling respects Retry-After', () => {
  it('waits the exact Retry-After duration before retrying a 429 response', async () => {
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call += 1;
      return call === 1 ? jsonResponse(429, {}, { 'Retry-After': '2' }) : jsonResponse(200, { value: [] });
    });
    const wait = vi.fn(async () => {});
    const adapter = createMicrosoftGraphAdapter({ account, oauth: fakeGraphOauth(), fetchImpl, wait });

    await adapter.listFolders({ credentialsProvider });
    expect(wait).toHaveBeenCalledWith(2_000);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe('Microsoft Graph adapter: drafts and send qualify only accepted_by_provider', () => {
  it('creates a draft message', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(201, { id: 'draft-1' }));
    const adapter = createMicrosoftGraphAdapter({ account, oauth: fakeGraphOauth(), fetchImpl });
    await expect(adapter.createDraft({ credentialsProvider, to: ['client@example.test'], subject: 'Bonjour', text: 'Contenu' }))
      .resolves.toEqual({ draftId: 'draft-1' });
  });

  it('sends a draft and reports accepted_by_provider on a 202 Accepted response', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(202, {}));
    const adapter = createMicrosoftGraphAdapter({ account, oauth: fakeGraphOauth(), fetchImpl });
    await expect(adapter.send({ credentialsProvider, draftId: 'draft-1' }))
      .resolves.toEqual({ state: 'accepted_by_provider', providerMessageId: 'draft-1' });
  });
});

describe('Microsoft Graph adapter: mark read is idempotent and confirmed by the response', () => {
  it('PATCHes isRead and requires the matching read message in the response', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { id: 'm1', isRead: true }));
    const adapter = createMicrosoftGraphAdapter({ account, oauth: fakeGraphOauth(), fetchImpl });

    await expect(adapter.markRead({ credentialsProvider, messageId: 'm1' }))
      .resolves.toEqual({ state: 'state_confirmed', providerMessageId: 'm1' });
    expect(fetchImpl).toHaveBeenCalledWith('https://graph.microsoft.com/v1.0/me/messages/m1', expect.objectContaining({
      method: 'PATCH', body: JSON.stringify({ isRead: true }),
    }));
  });

  it('does not claim confirmation when Graph does not return a read matching message', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { id: 'm1', isRead: false }));
    const adapter = createMicrosoftGraphAdapter({ account, oauth: fakeGraphOauth(), fetchImpl });

    await expect(adapter.markRead({ credentialsProvider, messageId: 'm1' }))
      .rejects.toThrow('microsoft_mark_read_unconfirmed');
  });
});

describe('Microsoft Graph adapter: archive is confirmed by a read from the well-known archive folder', () => {
  it('moves a message to archive then reads the returned destination message', async () => {
    const fetchImpl = vi.fn(async (url, options) => {
      if (url.endsWith('/messages/m1/move')) {
        expect(options).toMatchObject({ method: 'POST', body: JSON.stringify({ destinationId: 'archive' }) });
        return jsonResponse(201, { id: 'm2' });
      }
      if (url.endsWith('/mailFolders/archive/messages/m2')) return jsonResponse(200, { id: 'm2' });
      throw new Error(`unexpected_url:${url}`);
    });
    const adapter = createMicrosoftGraphAdapter({ account, oauth: fakeGraphOauth(), fetchImpl });

    await expect(adapter.archive({ credentialsProvider, messageId: 'm1' }))
      .resolves.toEqual({ state: 'state_confirmed', providerMessageId: 'm2' });
  });

  it('does not claim confirmation if the moved message cannot be read from archive', async () => {
    const fetchImpl = vi.fn(async (url) => url.endsWith('/move')
      ? jsonResponse(201, { id: 'm2' })
      : jsonResponse(404, {}));
    const adapter = createMicrosoftGraphAdapter({ account, oauth: fakeGraphOauth(), fetchImpl });

    await expect(adapter.archive({ credentialsProvider, messageId: 'm1' }))
      .rejects.toThrow('microsoft_graph_request_failed:404');
  });
});

describe('Microsoft Graph adapter: move is confirmed by a read from the requested destination folder', () => {
  it('moves a message to an explicit folder and rereads the Graph destination message', async () => {
    const fetchImpl = vi.fn(async (url, options) => {
      if (url.endsWith('/messages/m1/move')) {
        expect(options).toMatchObject({ method: 'POST', body: JSON.stringify({ destinationId: 'folder-1' }) });
        return jsonResponse(201, { id: 'm2' });
      }
      if (url.endsWith('/mailFolders/folder-1/messages/m2')) return jsonResponse(200, { id: 'm2' });
      throw new Error(`unexpected_url:${url}`);
    });
    const adapter = createMicrosoftGraphAdapter({ account, oauth: fakeGraphOauth(), fetchImpl });

    await expect(adapter.move({ credentialsProvider, messageId: 'm1', destinationId: 'folder-1' }))
      .resolves.toEqual({ state: 'state_confirmed', providerMessageId: 'm2' });
  });

  it('does not claim confirmation when Graph rereads a different destination message', async () => {
    const fetchImpl = vi.fn(async (url) => url.endsWith('/move')
      ? jsonResponse(201, { id: 'm2' })
      : jsonResponse(200, { id: 'm3' }));
    const adapter = createMicrosoftGraphAdapter({ account, oauth: fakeGraphOauth(), fetchImpl });

    await expect(adapter.move({ credentialsProvider, messageId: 'm1', destinationId: 'folder-1' }))
      .rejects.toThrow('microsoft_move_unconfirmed');
  });
});

describe('Microsoft Graph adapter: label uses existing master categories and rereads the message', () => {
  it('preserves unrelated categories while adding and removing only the requested categories', async () => {
    let messageReads = 0;
    const fetchImpl = vi.fn(async (url, options) => {
      if (url.endsWith('/outlook/masterCategories')) return jsonResponse(200, {
        value: [{ displayName: 'Finance' }, { displayName: 'Existing' }, { displayName: 'Remove' }],
      });
      if (url.includes('/messages/m1?')) {
        messageReads += 1;
        return jsonResponse(200, { id: 'm1', categories: messageReads === 1 ? ['Existing', 'Remove'] : ['Existing', 'Finance'] });
      }
      if (url.endsWith('/messages/m1')) {
        expect(options).toMatchObject({ method: 'PATCH', body: JSON.stringify({ categories: ['Existing', 'Finance'] }) });
        return jsonResponse(200, { id: 'm1', categories: ['Existing', 'Finance'] });
      }
      throw new Error(`unexpected_url:${url}`);
    });
    const adapter = createMicrosoftGraphAdapter({ account, oauth: fakeGraphOauth(), fetchImpl });

    await expect(adapter.label({
      credentialsProvider, messageId: 'm1', addCategories: ['Finance'], removeCategories: ['Remove'],
    })).resolves.toEqual({ state: 'state_confirmed', providerMessageId: 'm1' });
  });

  it('does not PATCH an add-category request that is absent from the master category list', async () => {
    const fetchImpl = vi.fn(async (url) => {
      if (url.endsWith('/outlook/masterCategories')) return jsonResponse(200, { value: [{ displayName: 'Existing' }] });
      throw new Error(`unexpected_url:${url}`);
    });
    const adapter = createMicrosoftGraphAdapter({ account, oauth: fakeGraphOauth(), fetchImpl });

    await expect(adapter.label({
      credentialsProvider, messageId: 'm1', addCategories: ['Finance'], removeCategories: [],
    })).rejects.toThrow('microsoft_label_category_unavailable');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('does not claim confirmation when the post-write reread omits an added category', async () => {
    let messageReads = 0;
    const fetchImpl = vi.fn(async (url) => {
      if (url.endsWith('/outlook/masterCategories')) return jsonResponse(200, { value: [{ displayName: 'Finance' }] });
      if (url.includes('/messages/m1?')) {
        messageReads += 1;
        return jsonResponse(200, { id: 'm1', categories: messageReads === 1 ? [] : [] });
      }
      if (url.endsWith('/messages/m1')) return jsonResponse(200, { id: 'm1', categories: ['Finance'] });
      throw new Error(`unexpected_url:${url}`);
    });
    const adapter = createMicrosoftGraphAdapter({ account, oauth: fakeGraphOauth(), fetchImpl });

    await expect(adapter.label({
      credentialsProvider, messageId: 'm1', addCategories: ['Finance'], removeCategories: [],
    })).rejects.toThrow('microsoft_label_unconfirmed');
  });
});

describe('Microsoft Graph adapter: trash is confirmed by a read from deleted items', () => {
  it('moves a message to deleted items and rereads the returned destination message', async () => {
    const fetchImpl = vi.fn(async (url, options) => {
      if (url.endsWith('/messages/m1/move')) {
        expect(options).toMatchObject({ method: 'POST', body: JSON.stringify({ destinationId: 'deleteditems' }) });
        return jsonResponse(201, { id: 'm2' });
      }
      if (url.endsWith('/mailFolders/deleteditems/messages/m2')) return jsonResponse(200, { id: 'm2' });
      throw new Error(`unexpected_url:${url}`);
    });
    const adapter = createMicrosoftGraphAdapter({ account, oauth: fakeGraphOauth(), fetchImpl });

    await expect(adapter.trash({ credentialsProvider, messageId: 'm1' }))
      .resolves.toEqual({ state: 'state_confirmed', providerMessageId: 'm2' });
  });

  it('does not claim confirmation when the message cannot be reread from deleted items', async () => {
    const fetchImpl = vi.fn(async (url) => url.endsWith('/move')
      ? jsonResponse(201, { id: 'm2' })
      : jsonResponse(200, { id: 'm3' }));
    const adapter = createMicrosoftGraphAdapter({ account, oauth: fakeGraphOauth(), fetchImpl });

    await expect(adapter.trash({ credentialsProvider, messageId: 'm1' }))
      .rejects.toThrow('microsoft_trash_unconfirmed');
  });
});

describe('Microsoft Graph adapter: declared operation capability boundary', () => {
  it('declares drafts and send, but not unimplemented mailbox mutations', () => {
    const adapter = createMicrosoftGraphAdapter({ account, oauth: fakeGraphOauth(), fetchImpl: vi.fn() });

    expect(adapter.capabilities).toContain('createDraft');
    expect(adapter.capabilities).toContain('send');
    expect(adapter.capabilities).toContain('markRead');
    expect(adapter.capabilities).toContain('archive');
    expect(adapter.capabilities).toContain('move');
    expect(adapter.capabilities).toContain('label');
    expect(adapter.capabilities).toContain('trash');
    expect(adapter.capabilities).not.toContain('markSpam');
    expect(adapter.capabilities).not.toContain('downloadAttachment');
    expect(adapter.capabilities).not.toContain('unsubscribe');
  });
});
