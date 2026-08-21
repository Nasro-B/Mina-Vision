import { describe, expect, it, vi } from 'vitest';
import { createGoogleRuntimeAdapters } from '../src/mail/google-runtime-adapters.mjs';

describe('Google runtime adapter composition', () => {
  it('binds configured Gmail credentials to mail and Tasks adapters', async () => {
    const oauth = {
      request: vi.fn(async (_credentials, options) => ({
        response: {
          data: options.url.endsWith('/messages/m1/trash')
            ? { id: 'm1', labelIds: ['TRASH'] }
            : options.url.endsWith('/messages/m1/modify')
            ? {
              id: 'm1',
              labelIds: options.data?.removeLabelIds?.includes('INBOX')
                ? options.data?.addLabelIds?.includes('Label_Destination')
                  ? ['ALL_MAIL', 'Label_Destination']
                  : ['ALL_MAIL']
                : options.data?.addLabelIds?.includes('Label_123')
                  ? ['INBOX', 'Label_123']
                  : options.data?.addLabelIds?.includes('SPAM')
                    ? ['SPAM']
                  : ['INBOX'],
            }
            : options.method === 'POST' ? { id: 'tk1', etag: '"r1"' } : {},
        },
      })),
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
    expect(result.mailAdapters['google-primary'].capabilities).toEqual(expect.arrayContaining(['sync', 'createDraft', 'send', 'markRead', 'label', 'move']));
    await expect(result.mailAdapters['google-primary'].markRead({ messageId: 'm1' }))
      .resolves.toEqual({ state: 'state_confirmed', providerMessageId: 'm1' });
    await expect(result.mailAdapters['google-primary'].archive({ messageId: 'm1' }))
      .resolves.toEqual({ state: 'state_confirmed', providerMessageId: 'm1' });
    await expect(result.mailAdapters['google-primary'].label({ messageId: 'm1', addLabelIds: ['Label_123'], removeLabelIds: [] }))
      .resolves.toEqual({ state: 'state_confirmed', providerMessageId: 'm1' });
    await expect(result.mailAdapters['google-primary'].move({
      messageId: 'm1', destinationLabelId: 'Label_Destination', sourceLabelIds: ['INBOX'],
    })).resolves.toEqual({ state: 'state_confirmed', providerMessageId: 'm1' });
    await expect(result.mailAdapters['google-primary'].trash({ messageId: 'm1' }))
      .resolves.toEqual({ state: 'state_confirmed', providerMessageId: 'm1' });
    await expect(result.mailAdapters['google-primary'].markSpam({ messageId: 'm1' }))
      .resolves.toEqual({ state: 'state_confirmed', providerMessageId: 'm1' });
    await expect(result.googlePersonalAdapter.create({ title: 'Test' })).resolves.toMatchObject({ taskId: 'tk1' });
    expect(getCredentials).toHaveBeenCalledWith('google-primary');
  });

  it('multi-comptes : un adaptateur mail par compte, mais Tâches/Contacts restent sur google-primary', async () => {
    const oauth = { request: vi.fn(async () => ({ response: { data: {} } })), generateConsentUrl: vi.fn() };
    const getCredentials = vi.fn(async () => ({ refreshToken: 'r' }));
    const result = await createGoogleRuntimeAdapters({
      // 'google-primary' n'est PAS premier dans la liste : prouve que la préférence n'est pas juste [0].
      accounts: [
        { accountId: 'google-contact-gmail-com', provider: 'gmail', address: 'contact@gmail.com' },
        { accountId: 'google-primary', provider: 'gmail', address: 'nasro@example.com' },
      ],
      getClientConfig: vi.fn(async () => JSON.stringify({ clientId: 'c', clientSecret: 's' })),
      getCredentials,
      createOAuthClient: vi.fn(async () => oauth),
    });
    // Mail = multi-compte : un adaptateur par compte.
    expect(result.operationalAccountIds).toEqual(expect.arrayContaining(['google-primary', 'google-contact-gmail-com']));
    expect(result.mailAdapters['google-primary']).toBeDefined();
    expect(result.mailAdapters['google-contact-gmail-com']).toBeDefined();
    // Tâches/Contacts (mono-compte) = compte PRINCIPAL, jamais le premier de la liste par hasard.
    await result.googlePersonalAdapter.create({ title: 'x' }).catch(() => {});
    expect(getCredentials).toHaveBeenCalledWith('google-primary');
    expect(getCredentials).not.toHaveBeenCalledWith('google-contact-gmail-com');
  });

  it('fails closed when OAuth client configuration is absent', async () => {
    const result = await createGoogleRuntimeAdapters({
      accounts: [{ accountId: 'google-primary', provider: 'gmail', address: 'nasro@example.com' }],
      getClientConfig: vi.fn(async () => null), getCredentials: vi.fn(), createOAuthClient: vi.fn(),
    });
    expect(result).toMatchObject({ operationalAccountIds: [], reason: 'google_oauth_client_config_missing' });
  });
});
