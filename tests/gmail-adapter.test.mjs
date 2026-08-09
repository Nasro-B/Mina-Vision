import { describe, expect, it, vi } from 'vitest';
import { createGoogleOAuthClient, GMAIL_SCOPES } from '../src/mail/oauth/google-oauth.mjs';
import { createGmailAdapter } from '../src/mail/adapters/gmail.mjs';

function fakeOAuth2Client() {
  const state = { credentials: {} };
  return {
    generateAuthUrl: vi.fn(({ scope }) => `https://accounts.google.com/o/oauth2/v2/auth?scope=${scope.join('+')}&access_type=offline`),
    getToken: vi.fn(async (code) => ({
      tokens: { access_token: `access-for-${code}`, refresh_token: `refresh-for-${code}`, expiry_date: 1_752_000_100_000 },
    })),
    setCredentials: vi.fn((credentials) => { state.credentials = credentials; }),
    get credentials() { return state.credentials; },
    request: vi.fn(async () => ({ data: {} })),
  };
}

describe('Google OAuth client: visible consent and token refresh', () => {
  it('generates a consent URL restricted to the minimum requested scopes', async () => {
    const fakeClient = fakeOAuth2Client();
    const oauth = await createGoogleOAuthClient({
      clientId: 'client-1', clientSecret: 'secret-1', redirectUri: 'http://localhost:53123/callback',
      importOAuth2Client: async () => function OAuth2Client() { return fakeClient; },
    });
    const url = oauth.generateConsentUrl([GMAIL_SCOPES.modify]);
    expect(url).toContain('access_type=offline');
    expect(fakeClient.generateAuthUrl).toHaveBeenCalledWith(expect.objectContaining({ prompt: 'consent', scope: [GMAIL_SCOPES.modify] }));
  });

  it('passes an explicit state through to generateAuthUrl for CSRF protection on the redirect', async () => {
    const fakeClient = fakeOAuth2Client();
    const oauth = await createGoogleOAuthClient({
      clientId: 'client-1', clientSecret: 'secret-1', redirectUri: 'http://127.0.0.1:53123/oauth/callback',
      importOAuth2Client: async () => function OAuth2Client() { return fakeClient; },
    });
    oauth.generateConsentUrl([GMAIL_SCOPES.modify], { state: 'nonce-abc' });
    expect(fakeClient.generateAuthUrl).toHaveBeenCalledWith(expect.objectContaining({ state: 'nonce-abc' }));
  });

  it('omits state entirely when not provided, rather than sending state:undefined', async () => {
    const fakeClient = fakeOAuth2Client();
    const oauth = await createGoogleOAuthClient({
      clientId: 'client-1', clientSecret: 'secret-1', redirectUri: 'http://localhost/callback',
      importOAuth2Client: async () => function OAuth2Client() { return fakeClient; },
    });
    oauth.generateConsentUrl([GMAIL_SCOPES.modify]);
    const call = fakeClient.generateAuthUrl.mock.calls[0][0];
    expect(Object.hasOwn(call, 'state')).toBe(false);
  });

  it('never silently falls back to the full mail.google.com scope', async () => {
    const oauth = await createGoogleOAuthClient({
      clientId: 'c', clientSecret: 's', redirectUri: 'http://localhost/callback',
      importOAuth2Client: async () => function OAuth2Client() { return fakeOAuth2Client(); },
    });
    expect(() => oauth.generateConsentUrl(['https://mail.google.com/'])).toThrow('google_oauth_scope_invalid');
  });

  it('exchanges an authorization code and requires a refresh token to be present', async () => {
    const fakeClient = fakeOAuth2Client();
    const oauth = await createGoogleOAuthClient({
      clientId: 'c', clientSecret: 's', redirectUri: 'http://localhost/callback',
      importOAuth2Client: async () => function OAuth2Client() { return fakeClient; },
    });
    await expect(oauth.exchangeCode('auth-code-1')).resolves.toEqual({
      accessToken: 'access-for-auth-code-1', refreshToken: 'refresh-for-auth-code-1', expiryDate: 1_752_000_100_000,
    });
  });

  it('returns refreshed credentials after a request so the caller can persist the new access token', async () => {
    const fakeClient = fakeOAuth2Client();
    fakeClient.request = vi.fn(async () => {
      // Simulate the underlying client rotating the access token during the call.
      fakeClient.setCredentials({ access_token: 'rotated-access', refresh_token: 'refresh-1', expiry_date: 999 });
      return { data: { ok: true } };
    });
    const oauth = await createGoogleOAuthClient({
      clientId: 'c', clientSecret: 's', redirectUri: 'http://localhost/callback',
      importOAuth2Client: async () => function OAuth2Client() { return fakeClient; },
    });
    const { refreshed } = await oauth.request({ refreshToken: 'refresh-1', accessToken: 'stale' }, { url: 'https://example.test' });
    expect(refreshed).toEqual({ accessToken: 'rotated-access', refreshToken: 'refresh-1', expiryDate: 999 });
  });
});

function fakeGmailOAuth(handlers = {}) {
  return {
    generateConsentUrl: vi.fn((scopes) => `https://accounts.google.com/consent?scope=${scopes.join('+')}`),
    request: vi.fn(async (credentials, options) => {
      const handler = handlers[options.url.split('?')[0]] ?? handlers.default;
      if (!handler) throw new Error(`unhandled_url:${options.url}`);
      return { response: await handler(options, credentials), refreshed: { accessToken: 'a', refreshToken: credentials.refreshToken, expiryDate: 1 } };
    }),
  };
}

const account = Object.freeze({ id: 'work-gmail', address: 'nasro@work.test' });
const credentialsProvider = async () => ({ refreshToken: 'refresh-1', accessToken: 'access-1' });

describe('Gmail adapter: identity, threads, and labels', () => {
  it('exposes only the minimum requested scopes, never the full mailbox scope', () => {
    expect(() => createGmailAdapter({ account, oauth: fakeGmailOAuth(), requestedScopes: ['https://mail.google.com/'] }))
      .toThrow('gmail_scope_invalid');
  });

  it('lists threads normalized to threadId and a bounded snippet', async () => {
    const adapter = createGmailAdapter({
      account,
      oauth: fakeGmailOAuth({ 'https://gmail.googleapis.com/gmail/v1/users/me/threads': async () => ({ data: { threads: [{ id: 't1', snippet: 'Bonjour' }] } }) }),
    });
    await expect(adapter.listThreads({ credentialsProvider })).resolves.toEqual([{ threadId: 't1', snippet: 'Bonjour' }]);
  });

  it('lists labels with id, name, and type', async () => {
    const adapter = createGmailAdapter({
      account,
      oauth: fakeGmailOAuth({ 'https://gmail.googleapis.com/gmail/v1/users/me/labels': async () => ({ data: { labels: [{ id: 'INBOX', name: 'INBOX', type: 'system' }] } }) }),
    });
    await expect(adapter.listLabels({ credentialsProvider })).resolves.toEqual([{ id: 'INBOX', name: 'INBOX', type: 'system' }]);
  });
});

describe('Gmail adapter: history-cursor sync and expired-history resync', () => {
  it('performs a full sync and returns the newest historyId when no cursor is provided', async () => {
    const persisted = [];
    const adapter = createGmailAdapter({
      account,
      oauth: fakeGmailOAuth({
        'https://gmail.googleapis.com/gmail/v1/users/me/messages': async () => ({ data: { messages: [{ id: 'm1', threadId: 't1' }] } }),
        'https://gmail.googleapis.com/gmail/v1/users/me/messages/m1': async () => ({
          data: { id: 'm1', threadId: 't1', historyId: 501, labelIds: ['INBOX'], snippet: 'Salut', payload: { headers: [{ name: 'Subject', value: 'Bonjour' }] } },
        }),
      }),
    });
    const result = await adapter.sync({ credentialsProvider, persist: async (message) => persisted.push(message) });
    expect(result).toEqual({ historyId: '501', imported: 1, resynced: true });
    expect(persisted[0]).toMatchObject({ providerMessageId: 'm1', threadId: 't1', subject: 'Bonjour', trust: 'external_untrusted' });
  });

  it('performs an incremental sync from a history cursor without re-fetching the whole mailbox', async () => {
    const persisted = [];
    const adapter = createGmailAdapter({
      account,
      oauth: fakeGmailOAuth({
        'https://gmail.googleapis.com/gmail/v1/users/me/history': async () => ({
          data: { historyId: 600, history: [{ id: 'h1', messagesAdded: [{ message: { id: 'm2', threadId: 't2' } }] }] },
        }),
        'https://gmail.googleapis.com/gmail/v1/users/me/messages/m2': async () => ({
          data: { id: 'm2', threadId: 't2', historyId: 600, labelIds: [], payload: { headers: [] } },
        }),
      }),
    });
    const result = await adapter.sync({ credentialsProvider, cursor: { historyId: '500' }, persist: async (message) => persisted.push(message) });
    expect(result).toEqual({ historyId: '600', imported: 1, resynced: false });
    expect(persisted).toHaveLength(1);
  });

  it('falls back to a bounded full resync when the history cursor has expired (404)', async () => {
    const persisted = [];
    const adapter = createGmailAdapter({
      account,
      oauth: fakeGmailOAuth({
        'https://gmail.googleapis.com/gmail/v1/users/me/history': async () => { throw Object.assign(new Error('not found'), { response: { status: 404 } }); },
        'https://gmail.googleapis.com/gmail/v1/users/me/messages': async () => ({ data: { messages: [{ id: 'm3', threadId: 't3' }] } }),
        'https://gmail.googleapis.com/gmail/v1/users/me/messages/m3': async () => ({ data: { id: 'm3', threadId: 't3', historyId: 700, payload: { headers: [] } } }),
      }),
    });
    const result = await adapter.sync({ credentialsProvider, cursor: { historyId: '1' }, persist: async (message) => persisted.push(message) });
    expect(result).toEqual({ historyId: '700', imported: 1, resynced: true });
  });
});

describe('Gmail adapter: attachment ingestion', () => {
  it('persists a bounded attachment nested in the MIME payload', async () => {
    const bytes = Buffer.from('%PDF-1.7 safe attachment', 'utf8');
    const persisted = [];
    const adapter = createGmailAdapter({
      account,
      oauth: fakeGmailOAuth({
        'https://gmail.googleapis.com/gmail/v1/users/me/messages': async () => ({ data: { messages: [{ id: 'm1', threadId: 't1' }] } }),
        'https://gmail.googleapis.com/gmail/v1/users/me/messages/m1': async () => ({
          data: {
            id: 'm1', threadId: 't1', historyId: 501, payload: {
              headers: [],
              parts: [{
                parts: [{
                  filename: 'devis.pdf', mimeType: 'application/pdf', body: { attachmentId: 'a1', size: bytes.length },
                }],
              }],
            },
          },
        }),
        'https://gmail.googleapis.com/gmail/v1/users/me/messages/m1/attachments/a1': async () => ({
          data: { size: bytes.length, data: bytes.toString('base64url') },
        }),
      }),
    });

    await adapter.sync({ credentialsProvider, persist: async (message) => persisted.push(message) });

    expect(persisted).toEqual([expect.objectContaining({
      attachments: [expect.objectContaining({
        filename: 'devis.pdf', contentType: 'application/pdf', bytes,
      })],
    })]);
  });

  it('rejects an attachment declared above the quarantine bound before fetching its bytes', async () => {
    const adapter = createGmailAdapter({
      account,
      oauth: fakeGmailOAuth({
        'https://gmail.googleapis.com/gmail/v1/users/me/messages': async () => ({ data: { messages: [{ id: 'm1', threadId: 't1' }] } }),
        'https://gmail.googleapis.com/gmail/v1/users/me/messages/m1': async () => ({
          data: {
            id: 'm1', threadId: 't1', payload: {
              headers: [],
              parts: [{ filename: 'trop-gros.pdf', mimeType: 'application/pdf', body: { attachmentId: 'a1', size: 26 * 1024 * 1024 } }],
            },
          },
        }),
        'https://gmail.googleapis.com/gmail/v1/users/me/messages/m1/attachments/a1': async () => {
          throw new Error('gmail_attachment_fetch_should_not_run');
        },
      }),
    });

    await expect(adapter.sync({ credentialsProvider, persist: async () => {} })).rejects.toThrow('gmail_attachment_too_large');
  });

  it('rejects a non-canonical base64url attachment payload', async () => {
    const adapter = createGmailAdapter({
      account,
      oauth: fakeGmailOAuth({
        'https://gmail.googleapis.com/gmail/v1/users/me/messages': async () => ({ data: { messages: [{ id: 'm1', threadId: 't1' }] } }),
        'https://gmail.googleapis.com/gmail/v1/users/me/messages/m1': async () => ({
          data: {
            id: 'm1', threadId: 't1', payload: {
              headers: [],
              parts: [{ filename: 'corrompu.pdf', mimeType: 'application/pdf', body: { attachmentId: 'a1', size: 3 } }],
            },
          },
        }),
        'https://gmail.googleapis.com/gmail/v1/users/me/messages/m1/attachments/a1': async () => ({
          data: { size: 3, data: '%%%' },
        }),
      }),
    });

    await expect(adapter.sync({ credentialsProvider, persist: async () => {} })).rejects.toThrow('gmail_attachment_payload_invalid');
  });
});

describe('Gmail adapter: drafts and send qualify only accepted_by_provider, never delivered', () => {
  it('creates a draft and returns its draft id and provider message id', async () => {
    const adapter = createGmailAdapter({
      account,
      oauth: fakeGmailOAuth({ 'https://gmail.googleapis.com/gmail/v1/users/me/drafts': async () => ({ data: { id: 'd1', message: { id: 'm9' } } }) }),
    });
    await expect(adapter.createDraft({ credentialsProvider, to: ['client@example.test'], subject: 'Bonjour', text: 'Contenu' }))
      .resolves.toEqual({ draftId: 'd1', providerMessageId: 'm9' });
  });

  it('sends a draft and reports accepted_by_provider, never delivered', async () => {
    const adapter = createGmailAdapter({
      account,
      oauth: fakeGmailOAuth({ 'https://gmail.googleapis.com/gmail/v1/users/me/drafts/send': async () => ({ data: { id: 'm10' } }) }),
    });
    await expect(adapter.send({ credentialsProvider, draftId: 'd1' })).resolves.toEqual({ state: 'accepted_by_provider', providerMessageId: 'm10' });
  });

  it('sends a raw message when no draft id is given', async () => {
    const adapter = createGmailAdapter({
      account,
      oauth: fakeGmailOAuth({ 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send': async () => ({ data: { id: 'm11' } }) }),
    });
    await expect(adapter.send({ credentialsProvider, to: ['client@example.test'], subject: 'Bonjour', text: 'Contenu' }))
      .resolves.toEqual({ state: 'accepted_by_provider', providerMessageId: 'm11' });
  });
});

describe('Gmail adapter: mark read is idempotent and confirmed by the returned message labels', () => {
  it('removes UNREAD and confirms the provider returned no unread label', async () => {
    const oauth = fakeGmailOAuth({
      'https://gmail.googleapis.com/gmail/v1/users/me/messages/m1/modify': async (options) => {
        expect(options).toMatchObject({ method: 'POST', data: { removeLabelIds: ['UNREAD'] } });
        return { data: { id: 'm1', labelIds: ['INBOX'] } };
      },
    });
    const adapter = createGmailAdapter({ account, oauth });

    await expect(adapter.markRead({ credentialsProvider, messageId: 'm1' }))
      .resolves.toEqual({ state: 'state_confirmed', providerMessageId: 'm1' });
  });

  it('does not claim confirmation when Gmail still returns UNREAD', async () => {
    const adapter = createGmailAdapter({
      account,
      oauth: fakeGmailOAuth({
        'https://gmail.googleapis.com/gmail/v1/users/me/messages/m1/modify': async () => ({ data: { id: 'm1', labelIds: ['INBOX', 'UNREAD'] } }),
      }),
    });

    await expect(adapter.markRead({ credentialsProvider, messageId: 'm1' }))
      .rejects.toThrow('gmail_mark_read_unconfirmed');
  });
});

describe('Gmail adapter: archive is idempotent and confirmed by the returned message labels', () => {
  it('removes INBOX and confirms the provider returned no inbox label', async () => {
    const oauth = fakeGmailOAuth({
      'https://gmail.googleapis.com/gmail/v1/users/me/messages/m1/modify': async (options) => {
        expect(options).toMatchObject({ method: 'POST', data: { removeLabelIds: ['INBOX'] } });
        return { data: { id: 'm1', labelIds: ['ALL_MAIL'] } };
      },
    });
    const adapter = createGmailAdapter({ account, oauth });

    await expect(adapter.archive({ credentialsProvider, messageId: 'm1' }))
      .resolves.toEqual({ state: 'state_confirmed', providerMessageId: 'm1' });
  });

  it('does not claim confirmation when Gmail still returns INBOX', async () => {
    const adapter = createGmailAdapter({
      account,
      oauth: fakeGmailOAuth({
        'https://gmail.googleapis.com/gmail/v1/users/me/messages/m1/modify': async () => ({ data: { id: 'm1', labelIds: ['INBOX'] } }),
      }),
    });

    await expect(adapter.archive({ credentialsProvider, messageId: 'm1' }))
      .rejects.toThrow('gmail_archive_unconfirmed');
  });
});

describe('Gmail adapter: label mutation is confirmed by the returned message labels', () => {
  it('adds and removes only the requested labels before returning state_confirmed', async () => {
    const oauth = fakeGmailOAuth({
      'https://gmail.googleapis.com/gmail/v1/users/me/messages/m1/modify': async (options) => {
        expect(options).toMatchObject({
          method: 'POST',
          data: { addLabelIds: ['Label_123'], removeLabelIds: ['OLD'] },
        });
        return { data: { id: 'm1', labelIds: ['INBOX', 'Label_123'] } };
      },
    });
    const adapter = createGmailAdapter({ account, oauth });

    await expect(adapter.label({
      credentialsProvider, messageId: 'm1', addLabelIds: ['Label_123'], removeLabelIds: ['OLD'],
    })).resolves.toEqual({ state: 'state_confirmed', providerMessageId: 'm1' });
  });

  it('does not claim confirmation when Gmail omits an added label', async () => {
    const adapter = createGmailAdapter({
      account,
      oauth: fakeGmailOAuth({
        'https://gmail.googleapis.com/gmail/v1/users/me/messages/m1/modify': async () => ({ data: { id: 'm1', labelIds: ['INBOX'] } }),
      }),
    });

    await expect(adapter.label({
      credentialsProvider, messageId: 'm1', addLabelIds: ['Label_123'], removeLabelIds: [],
    })).rejects.toThrow('gmail_label_unconfirmed');
  });

  it('rejects duplicate or contradictory labels before contacting Gmail', async () => {
    const oauth = fakeGmailOAuth();
    const adapter = createGmailAdapter({ account, oauth });

    await expect(adapter.label({
      credentialsProvider, messageId: 'm1', addLabelIds: ['Label_123', 'Label_123'], removeLabelIds: [],
    })).rejects.toThrow('gmail_label_request_invalid');
    await expect(adapter.label({
      credentialsProvider, messageId: 'm1', addLabelIds: ['Label_123'], removeLabelIds: ['Label_123'],
    })).rejects.toThrow('gmail_label_request_invalid');
    expect(oauth.request).not.toHaveBeenCalled();
  });
});

describe('Gmail adapter: move is confirmed by the returned destination and source labels', () => {
  it('adds the requested destination label and removes every requested source label', async () => {
    const oauth = fakeGmailOAuth({
      'https://gmail.googleapis.com/gmail/v1/users/me/messages/m1/modify': async (options) => {
        expect(options).toMatchObject({
          method: 'POST',
          data: { addLabelIds: ['Label_Destination'], removeLabelIds: ['INBOX'] },
        });
        return { data: { id: 'm1', labelIds: ['ALL_MAIL', 'Label_Destination'] } };
      },
    });
    const adapter = createGmailAdapter({ account, oauth });

    await expect(adapter.move({
      credentialsProvider, messageId: 'm1', destinationLabelId: 'Label_Destination', sourceLabelIds: ['INBOX'],
    })).resolves.toEqual({ state: 'state_confirmed', providerMessageId: 'm1' });
  });

  it('does not claim confirmation when Gmail still returns a source label', async () => {
    const adapter = createGmailAdapter({
      account,
      oauth: fakeGmailOAuth({
        'https://gmail.googleapis.com/gmail/v1/users/me/messages/m1/modify': async () => ({
          data: { id: 'm1', labelIds: ['INBOX', 'Label_Destination'] },
        }),
      }),
    });

    await expect(adapter.move({
      credentialsProvider, messageId: 'm1', destinationLabelId: 'Label_Destination', sourceLabelIds: ['INBOX'],
    })).rejects.toThrow('gmail_move_unconfirmed');
  });
});

describe('Gmail adapter: trash is confirmed by the returned system label', () => {
  it('moves the message to Gmail trash and requires TRASH in the returned message', async () => {
    const oauth = fakeGmailOAuth({
      'https://gmail.googleapis.com/gmail/v1/users/me/messages/m1/trash': async (options) => {
        expect(options).toMatchObject({ method: 'POST' });
        return { data: { id: 'm1', labelIds: ['TRASH'] } };
      },
    });
    const adapter = createGmailAdapter({ account, oauth });

    await expect(adapter.trash({ credentialsProvider, messageId: 'm1' }))
      .resolves.toEqual({ state: 'state_confirmed', providerMessageId: 'm1' });
  });

  it('does not claim confirmation when Gmail does not return TRASH', async () => {
    const adapter = createGmailAdapter({
      account,
      oauth: fakeGmailOAuth({
        'https://gmail.googleapis.com/gmail/v1/users/me/messages/m1/trash': async () => ({ data: { id: 'm1', labelIds: ['INBOX'] } }),
      }),
    });

    await expect(adapter.trash({ credentialsProvider, messageId: 'm1' }))
      .rejects.toThrow('gmail_trash_unconfirmed');
  });
});

describe('Gmail adapter: mark spam is confirmed by the returned system label', () => {
  it('adds SPAM and requires it in the returned message before reporting state_confirmed', async () => {
    const oauth = fakeGmailOAuth({
      'https://gmail.googleapis.com/gmail/v1/users/me/messages/m1/modify': async (options) => {
        expect(options).toMatchObject({ method: 'POST', data: { addLabelIds: ['SPAM'] } });
        return { data: { id: 'm1', labelIds: ['SPAM'] } };
      },
    });
    const adapter = createGmailAdapter({ account, oauth });

    await expect(adapter.markSpam({ credentialsProvider, messageId: 'm1' }))
      .resolves.toEqual({ state: 'state_confirmed', providerMessageId: 'm1' });
  });

  it('does not claim confirmation when Gmail omits SPAM', async () => {
    const adapter = createGmailAdapter({
      account,
      oauth: fakeGmailOAuth({
        'https://gmail.googleapis.com/gmail/v1/users/me/messages/m1/modify': async () => ({ data: { id: 'm1', labelIds: ['INBOX'] } }),
      }),
    });

    await expect(adapter.markSpam({ credentialsProvider, messageId: 'm1' }))
      .rejects.toThrow('gmail_mark_spam_unconfirmed');
  });
});

describe('Gmail adapter: declared operation capability boundary', () => {
  it('declares only the operations its concrete adapter exposes', () => {
    const adapter = createGmailAdapter({ account, oauth: fakeGmailOAuth() });

    expect(adapter.capabilities).toContain('createDraft');
    expect(adapter.capabilities).toContain('send');
    expect(adapter.capabilities).toContain('markRead');
    expect(adapter.capabilities).toContain('archive');
    expect(adapter.capabilities).toContain('label');
    expect(adapter.capabilities).toContain('move');
    expect(adapter.capabilities).toContain('trash');
    expect(adapter.capabilities).toContain('markSpam');
    expect(adapter.capabilities).not.toContain('downloadAttachment');
    expect(adapter.capabilities).not.toContain('unsubscribe');
  });
});
