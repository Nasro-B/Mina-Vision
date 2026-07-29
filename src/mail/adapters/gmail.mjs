import { GMAIL_SCOPES } from '../oauth/google-oauth.mjs';

const ID = /^[A-Za-z0-9._:-]{1,160}$/u;
const MAX_SYNC_MESSAGES = 100;
const BASE_URL = 'https://gmail.googleapis.com/gmail/v1/users/me';
const FORBIDDEN_FULL_SCOPE = 'https://mail.google.com/';

function headerValue(headers, name) {
  return headers.find((header) => header.name?.toLowerCase() === name)?.value ?? null;
}

function normalizeMessage(raw) {
  if (!ID.test(raw?.id ?? '') || !ID.test(raw?.threadId ?? '')) throw new Error('gmail_message_invalid');
  const headers = raw.payload?.headers ?? [];
  return Object.freeze({
    provider: 'gmail',
    providerMessageId: raw.id,
    threadId: raw.threadId,
    historyId: raw.historyId != null ? String(raw.historyId) : null,
    labelIds: Object.freeze([...(raw.labelIds ?? [])]),
    subject: headerValue(headers, 'subject') ?? '',
    from: headerValue(headers, 'from') ?? '',
    internetMessageId: headerValue(headers, 'message-id'),
    internalDate: raw.internalDate != null ? String(raw.internalDate) : null,
    snippet: String(raw.snippet ?? '').slice(0, 500),
    trust: 'external_untrusted',
  });
}

function isHistoryExpired(error) {
  return error?.response?.status === 404 || error?.code === 404 || error?.status === 404;
}

export function createGmailAdapter({
  account,
  oauth,
  requestedScopes = [GMAIL_SCOPES.modify, GMAIL_SCOPES.send],
} = {}) {
  if (!ID.test(account?.id ?? '') || typeof account?.address !== 'string' || !account.address.includes('@')) {
    throw new TypeError('gmail_account_invalid');
  }
  if (!oauth?.request || !oauth?.generateConsentUrl) throw new TypeError('gmail_oauth_client_required');
  if (!Array.isArray(requestedScopes) || requestedScopes.length < 1 || requestedScopes.includes(FORBIDDEN_FULL_SCOPE)) {
    throw new TypeError('gmail_scope_invalid');
  }

  async function call(credentialsProvider, options) {
    const credentials = await credentialsProvider(account.id);
    return oauth.request(credentials, options);
  }

  async function fullSync(credentialsProvider, persist) {
    const { response } = await call(credentialsProvider, {
      url: `${BASE_URL}/messages`,
      params: { maxResults: MAX_SYNC_MESSAGES },
    });
    let historyId = null;
    let imported = 0;
    for (const item of (response.data.messages ?? []).slice(0, MAX_SYNC_MESSAGES)) {
      const { response: full } = await call(credentialsProvider, { url: `${BASE_URL}/messages/${item.id}` });
      const message = normalizeMessage(full.data);
      await persist(message);
      historyId = message.historyId ?? historyId;
      imported += 1;
    }
    return Object.freeze({ historyId, imported, resynced: true });
  }

  async function incrementalSync(credentialsProvider, persist, startHistoryId) {
    const { response } = await call(credentialsProvider, {
      url: `${BASE_URL}/history`,
      params: { startHistoryId },
    });
    let imported = 0;
    outer: for (const record of (response.data.history ?? [])) {
      for (const added of (record.messagesAdded ?? [])) {
        const { response: full } = await call(credentialsProvider, { url: `${BASE_URL}/messages/${added.message.id}` });
        await persist(normalizeMessage(full.data));
        imported += 1;
        if (imported >= MAX_SYNC_MESSAGES) break outer;
      }
    }
    return Object.freeze({
      historyId: response.data.historyId != null ? String(response.data.historyId) : startHistoryId,
      imported,
      resynced: false,
    });
  }

  return Object.freeze({
    id: account.id,
    provider: 'gmail',
    scopes: Object.freeze([...requestedScopes]),
    capabilities: Object.freeze(['sync', 'listThreads', 'listLabels', 'createDraft', 'send', 'markRead', 'archive']),

    getConsentUrl: () => oauth.generateConsentUrl(requestedScopes),

    async sync({ credentialsProvider, cursor = null, persist } = {}) {
      if (typeof credentialsProvider !== 'function' || typeof persist !== 'function') {
        throw new TypeError('gmail_sync_request_invalid');
      }
      if (!cursor?.historyId) return fullSync(credentialsProvider, persist);
      try {
        return await incrementalSync(credentialsProvider, persist, cursor.historyId);
      } catch (error) {
        if (isHistoryExpired(error)) return fullSync(credentialsProvider, persist);
        throw error;
      }
    },

    async listThreads({ credentialsProvider, maxResults = 25 } = {}) {
      if (typeof credentialsProvider !== 'function' || !Number.isInteger(maxResults) || maxResults < 1 || maxResults > 100) {
        throw new TypeError('gmail_threads_request_invalid');
      }
      const { response } = await call(credentialsProvider, { url: `${BASE_URL}/threads`, params: { maxResults } });
      return Object.freeze((response.data.threads ?? []).map((thread) => Object.freeze({
        threadId: thread.id, snippet: String(thread.snippet ?? '').slice(0, 500),
      })));
    },

    async listLabels({ credentialsProvider } = {}) {
      if (typeof credentialsProvider !== 'function') throw new TypeError('gmail_labels_request_invalid');
      const { response } = await call(credentialsProvider, { url: `${BASE_URL}/labels` });
      return Object.freeze((response.data.labels ?? []).map((label) => Object.freeze({ id: label.id, name: label.name, type: label.type })));
    },

    async createDraft({ credentialsProvider, to, subject, text } = {}) {
      if (typeof credentialsProvider !== 'function' || !Array.isArray(to) || to.length < 1
        || to.some((address) => typeof address !== 'string' || !address.includes('@'))
        || typeof subject !== 'string' || typeof text !== 'string' || text.length < 1) {
        throw new TypeError('gmail_draft_request_invalid');
      }
      const raw = Buffer.from(`To: ${to.join(', ')}\r\nSubject: ${subject}\r\n\r\n${text}`, 'utf8').toString('base64url');
      const { response } = await call(credentialsProvider, {
        url: `${BASE_URL}/drafts`, method: 'POST', data: { message: { raw } },
      });
      return Object.freeze({ draftId: response.data.id, providerMessageId: response.data.message?.id ?? null });
    },

    async send({ credentialsProvider, draftId, to, subject, text } = {}) {
      if (typeof credentialsProvider !== 'function') throw new TypeError('gmail_send_request_invalid');
      let response;
      if (typeof draftId === 'string' && draftId.length > 0) {
        ({ response } = await call(credentialsProvider, {
          url: `${BASE_URL}/drafts/send`, method: 'POST', data: { id: draftId },
        }));
      } else {
        if (!Array.isArray(to) || to.length < 1 || typeof subject !== 'string' || typeof text !== 'string' || text.length < 1) {
          throw new TypeError('gmail_send_request_invalid');
        }
        const raw = Buffer.from(`To: ${to.join(', ')}\r\nSubject: ${subject}\r\n\r\n${text}`, 'utf8').toString('base64url');
        ({ response } = await call(credentialsProvider, {
          url: `${BASE_URL}/messages/send`, method: 'POST', data: { raw },
        }));
      }
      if (!ID.test(response.data?.id ?? '')) throw new Error('gmail_send_response_invalid');
      return Object.freeze({ state: 'accepted_by_provider', providerMessageId: response.data.id });
    },

    async markRead({ credentialsProvider, messageId } = {}) {
      if (typeof credentialsProvider !== 'function' || !ID.test(messageId ?? '')) {
        throw new TypeError('gmail_mark_read_request_invalid');
      }
      const { response } = await call(credentialsProvider, {
        url: `${BASE_URL}/messages/${encodeURIComponent(messageId)}/modify`,
        method: 'POST',
        data: { removeLabelIds: ['UNREAD'] },
      });
      if (response.data?.id !== messageId || !Array.isArray(response.data?.labelIds)
        || response.data.labelIds.includes('UNREAD')) {
        throw new Error('gmail_mark_read_unconfirmed');
      }
      return Object.freeze({ state: 'state_confirmed', providerMessageId: messageId });
    },

    async archive({ credentialsProvider, messageId } = {}) {
      if (typeof credentialsProvider !== 'function' || !ID.test(messageId ?? '')) {
        throw new TypeError('gmail_archive_request_invalid');
      }
      const { response } = await call(credentialsProvider, {
        url: `${BASE_URL}/messages/${encodeURIComponent(messageId)}/modify`,
        method: 'POST',
        data: { removeLabelIds: ['INBOX'] },
      });
      if (response.data?.id !== messageId || !Array.isArray(response.data?.labelIds)
        || response.data.labelIds.includes('INBOX')) {
        throw new Error('gmail_archive_unconfirmed');
      }
      return Object.freeze({ state: 'state_confirmed', providerMessageId: messageId });
    },
  });
}
