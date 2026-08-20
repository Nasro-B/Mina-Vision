import { describe, expect, it, vi } from 'vitest';
import { createGoogleAccountConnector } from '../src/mail/oauth/google-account-connector.mjs';

function fakeKeyring(secrets = new Map()) {
  return {
    setSecret: vi.fn(async (name, value) => secrets.set(name, value)),
    getSecret: vi.fn(async (name) => secrets.get(name) ?? null),
  };
}

function fakeMailAccountStore() {
  const saved = [];
  return { saved, save: vi.fn(async (accountId, record) => { saved.push({ accountId, record }); return { accountId, saved: true }; }) };
}

function fakeOAuthClient(overrides = {}) {
  return {
    generateConsentUrl: vi.fn((scopes, opts) => `https://accounts.google.com/consent?scope=${scopes.join('+')}&state=${opts?.state}`),
    exchangeCode: vi.fn(async (code) => ({ accessToken: `access-${code}`, refreshToken: `refresh-${code}`, expiryDate: 1_700_000_000_000 })),
    ...overrides,
  };
}

function fakeLoopbackServer({ codeResult, rejection } = {}) {
  const stop = vi.fn(async () => {});
  return {
    start: vi.fn(async () => ({ port: 54321 })),
    waitForCode: vi.fn(async () => {
      if (rejection) throw rejection;
      return codeResult ?? { code: 'auth-code-1', state: 'expected-state' };
    }),
    stop,
  };
}

function buildConnector(overrides = {}) {
  const keyring = overrides.keyring ?? fakeKeyring();
  const mailAccountStore = overrides.mailAccountStore ?? fakeMailAccountStore();
  const oauthClient = overrides.oauthClient ?? fakeOAuthClient();
  const loopbackServer = overrides.loopbackServer ?? fakeLoopbackServer();
  const openExternal = overrides.openExternal ?? vi.fn(async () => {});
  const onConsentUrl = overrides.onConsentUrl ?? vi.fn(() => {});
  const prompt = overrides.prompt ?? vi.fn(async () => 'never-called');
  const storage = overrides.storage ?? { read: vi.fn(async () => ({ version: 1 })) };

  const connector = createGoogleAccountConnector({
    storage, keyring, mailAccountStore, openExternal, prompt, onConsentUrl,
    createLoopbackServer: () => loopbackServer,
    createOAuthClient: async () => oauthClient,
    generateState: () => 'expected-state',
    scopes: ['scope-a', 'scope-b'],
    accountId: 'google-primary',
    address: 'owner@example.com',
    clock: () => 1_700_000_000_000,
  });
  return { connector, keyring, mailAccountStore, oauthClient, loopbackServer, openExternal, onConsentUrl, prompt, storage };
}

describe('createGoogleAccountConnector: constructor guards', () => {
  it('requires a keyring', () => {
    expect(() => createGoogleAccountConnector({})).toThrow('google_account_connector_keyring_required');
  });
});

describe('createGoogleAccountConnector.connect: vault must be initialized first', () => {
  it('returns vault_not_initialized without ever prompting or opening a browser', async () => {
    const storage = { read: vi.fn(async () => null) };
    const { connector, prompt, openExternal } = buildConnector({ storage });
    const result = await connector.connect();
    expect(result).toEqual({ status: 'vault_not_initialized' });
    expect(prompt).not.toHaveBeenCalled();
    expect(openExternal).not.toHaveBeenCalled();
  });
});

describe('createGoogleAccountConnector.connect: client config is prompted once, then reused', () => {
  it('prompts for and persists clientId/clientSecret when none is stored yet', async () => {
    const prompt = vi.fn()
      .mockResolvedValueOnce('client-id-123')
      .mockResolvedValueOnce('client-secret-456');
    const { connector, keyring } = buildConnector({ prompt });
    const result = await connector.connect();
    expect(result.status).toBe('connected');
    expect(prompt).toHaveBeenCalledTimes(2);
    expect(keyring.setSecret).toHaveBeenCalledWith('google/oauth/client-config', JSON.stringify({ clientId: 'client-id-123', clientSecret: 'client-secret-456' }));
  });

  it('reuses an already-stored client config without prompting again', async () => {
    const keyring = fakeKeyring(new Map([['google/oauth/client-config', JSON.stringify({ clientId: 'stored-id', clientSecret: 'stored-secret' })]]));
    const { connector, prompt } = buildConnector({ keyring });
    const result = await connector.connect();
    expect(result.status).toBe('connected');
    expect(prompt).not.toHaveBeenCalled();
  });

  it('fails closed when clientId/clientSecret are left empty', async () => {
    const prompt = vi.fn().mockResolvedValueOnce('').mockResolvedValueOnce('');
    const { connector, keyring } = buildConnector({ prompt });
    const result = await connector.connect();
    expect(result).toEqual({ status: 'client_config_required' });
    expect(keyring.setSecret).not.toHaveBeenCalled();
  });

  it('does not persist a newly typed client config when Google denies consent', async () => {
    const prompt = vi.fn()
      .mockResolvedValueOnce('wrong-client-id')
      .mockResolvedValueOnce('wrong-client-secret');
    const loopbackServer = fakeLoopbackServer({ rejection: new Error('oauth_loopback_denied:access_denied') });
    const { connector, keyring } = buildConnector({ prompt, loopbackServer });
    const result = await connector.connect();
    expect(result).toEqual({ status: 'denied', reason: 'oauth_loopback_denied:access_denied' });
    expect(keyring.setSecret).not.toHaveBeenCalled();
  });
});

describe('createGoogleAccountConnector.connect: exact plan scenario (consent, callback, exchange, save)', () => {
  it('opens the real consent URL with all requested scopes and a fresh state, never a static one', async () => {
    const oauthClient = fakeOAuthClient();
    const { connector, openExternal, onConsentUrl } = buildConnector({ oauthClient });
    await connector.connect();
    expect(oauthClient.generateConsentUrl).toHaveBeenCalledWith(['scope-a', 'scope-b'], { state: 'expected-state' });
    expect(openExternal).toHaveBeenCalledWith(expect.stringContaining('state=expected-state'));
    expect(onConsentUrl).toHaveBeenCalledWith(expect.stringContaining('state=expected-state'));
  });

  it('saves the exchanged tokens into mail-account-store under the configured accountId', async () => {
    const { connector, mailAccountStore } = buildConnector();
    const result = await connector.connect();
    expect(result).toEqual({ status: 'connected', accountId: 'google-primary' });
    expect(mailAccountStore.saved).toEqual([{
      accountId: 'google-primary',
      record: {
        provider: 'gmail', address: 'owner@example.com', mode: 1,
        credentials: { accessToken: 'access-auth-code-1', refreshToken: 'refresh-auth-code-1', expiryDate: 1_700_000_000_000 },
      },
    }]);
  });

  it('always stops the loopback server, even after a successful exchange', async () => {
    const loopbackServer = fakeLoopbackServer();
    const { connector } = buildConnector({ loopbackServer });
    await connector.connect();
    expect(loopbackServer.stop).toHaveBeenCalledTimes(1);
  });

  it('reports denied and stops the server when the user refuses consent, without ever calling exchangeCode', async () => {
    const loopbackServer = fakeLoopbackServer({ rejection: new Error('oauth_loopback_denied:access_denied') });
    const oauthClient = fakeOAuthClient();
    const { connector, mailAccountStore } = buildConnector({ loopbackServer, oauthClient });
    const result = await connector.connect();
    expect(result).toEqual({ status: 'denied', reason: 'oauth_loopback_denied:access_denied' });
    expect(oauthClient.exchangeCode).not.toHaveBeenCalled();
    expect(mailAccountStore.saved).toEqual([]);
    expect(loopbackServer.stop).toHaveBeenCalledTimes(1);
  });

  it('reports denied on a loopback timeout the same way as an explicit refusal', async () => {
    const loopbackServer = fakeLoopbackServer({ rejection: new Error('oauth_loopback_timeout') });
    const { connector } = buildConnector({ loopbackServer });
    const result = await connector.connect();
    expect(result).toEqual({ status: 'denied', reason: 'oauth_loopback_timeout' });
  });
});
