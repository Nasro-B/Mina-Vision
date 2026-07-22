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
