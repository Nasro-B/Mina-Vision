import { describe, expect, it, vi } from 'vitest';
import { createGoogleRuntimeAdapters } from '../src/mail/google-runtime-adapters.mjs';

describe('Google runtime adapter composition', () => {
  it('binds configured Gmail credentials to mail and Tasks adapters', async () => {
    const oauth = {
      request: vi.fn(async (_credentials, options) => ({ response: { data: options.method === 'POST' ? { id: 'tk1', etag: '"r1"' } : {} } })),
      generateConsentUrl: vi.fn(),
    };
    const getCredentials = vi.fn(async () => ({ refreshToken: 'refresh' }));
    const result = await createGoogleRuntimeAdapters({
      accounts: [{ accountId: 'google-primary', provider: 'gmail', address: 'nasro@example.com' }],
      getClientConfig: vi.fn(async () => JSON.stringify({ clientId: 'client', clientSecret: 'secret' })),
      getCredentials,
      createOAuthClient: vi.fn(async () => oauth),
    });

    expect(result.operationalAccountIds).toEqual(['google-primary']);
    expect(result.mailAdapters['google-primary']).toBeDefined();
    await expect(result.googlePersonalAdapter.create({ title: 'Test' })).resolves.toMatchObject({ taskId: 'tk1' });
    expect(getCredentials).toHaveBeenCalledWith('google-primary');
  });

  it('fails closed when OAuth client configuration is absent', async () => {
    const result = await createGoogleRuntimeAdapters({
      accounts: [{ accountId: 'google-primary', provider: 'gmail', address: 'nasro@example.com' }],
      getClientConfig: vi.fn(async () => null), getCredentials: vi.fn(), createOAuthClient: vi.fn(),
    });
    expect(result).toMatchObject({ operationalAccountIds: [], reason: 'google_oauth_client_config_missing' });
  });
});
