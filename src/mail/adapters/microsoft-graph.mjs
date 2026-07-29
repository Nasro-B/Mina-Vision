const ID = /^[A-Za-z0-9._:-]{1,160}$/u;
const MAX_SYNC_MESSAGES = 100;
const MAX_THROTTLE_RETRIES = 3;
const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

function normalizeMessage(raw) {
  if (typeof raw?.id !== 'string' || raw.id.length < 1) throw new Error('microsoft_message_invalid');
  return Object.freeze({
    provider: 'microsoft',
    providerMessageId: raw.id,
    internetMessageId: typeof raw.internetMessageId === 'string' ? raw.internetMessageId : null,
    subject: String(raw.subject ?? '').slice(0, 998),
    receivedAt: typeof raw.receivedDateTime === 'string' ? raw.receivedDateTime : null,
    bodyText: String(raw.body?.content ?? '').slice(0, 2_000_000),
    trust: 'external_untrusted',
  });
}

function graphMessagePath(messageId, errorCode) {
  if (typeof messageId !== 'string' || messageId.length < 1 || messageId.length > 2_048 || /[\u0000\r\n]/u.test(messageId)) {
    throw new TypeError(errorCode);
  }
  return encodeURIComponent(messageId);
}

async function parseJson(response) {
  const text = await response.text();
  return text.length > 0 ? JSON.parse(text) : {};
}

export function createMicrosoftGraphAdapter({
  account,
  oauth,
  requiredTenantId = null,
  fetchImpl = fetch,
  wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
} = {}) {
  if (!ID.test(account?.id ?? '') || typeof account?.address !== 'string' || !account.address.includes('@')) {
    throw new TypeError('microsoft_graph_account_invalid');
  }
  if (!oauth?.refresh) throw new TypeError('microsoft_graph_oauth_client_required');

  async function call(credentialsProvider, { url, method = 'GET', body } = {}, attempt = 0) {
    const credentials = await credentialsProvider(account.id);
    const token = await oauth.refresh({ refreshToken: credentials.refreshToken, scopes: credentials.scopes });
    if (requiredTenantId && token.tenantId !== requiredTenantId) throw new Error('microsoft_tenant_mismatch');
    if (token.username.toLowerCase() !== account.address.toLowerCase()) throw new Error('microsoft_account_mismatch');

    const response = await fetchImpl(url, {
      method,
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: body != null ? JSON.stringify(body) : undefined,
    });

    if (response.status === 429 && attempt < MAX_THROTTLE_RETRIES) {
      const retryAfterSeconds = Number(response.headers?.get?.('Retry-After') ?? 1);
      await wait((Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : 1) * 1000);
      return call(credentialsProvider, { url, method, body }, attempt + 1);
    }
    if (response.status >= 400 && response.status !== 410) {
      throw Object.assign(new Error(`microsoft_graph_request_failed:${response.status}`), { status: response.status });
    }
    return { status: response.status, data: await parseJson(response) };
  }

  async function fullSync(credentialsProvider, persist, folderId) {
    let url = `${GRAPH_BASE}/me/mailFolders/${folderId}/messages/delta`;
    let deltaLink = null;
    let imported = 0;
    while (url && imported < MAX_SYNC_MESSAGES) {
      const { data } = await call(credentialsProvider, { url });
      for (const item of (data.value ?? [])) {
        if (imported >= MAX_SYNC_MESSAGES) break;
        await persist(normalizeMessage(item));
        imported += 1;
      }
      deltaLink = data['@odata.deltaLink'] ?? deltaLink;
      url = data['@odata.nextLink'] ?? null;
    }
    return Object.freeze({ deltaLink, imported, resynced: true });
  }

  return Object.freeze({
    id: account.id,
    provider: 'microsoft',
    capabilities: Object.freeze(['sync', 'listFolders', 'createDraft', 'send', 'markRead', 'archive']),

    async sync({ credentialsProvider, folderId = 'inbox', cursor = null, persist } = {}) {
      if (typeof credentialsProvider !== 'function' || typeof persist !== 'function') {
        throw new TypeError('microsoft_sync_request_invalid');
      }
      if (!cursor?.deltaLink) return fullSync(credentialsProvider, persist, folderId);

      let url = cursor.deltaLink;
      let deltaLink = cursor.deltaLink;
      let imported = 0;
      while (url && imported < MAX_SYNC_MESSAGES) {
        const { status, data } = await call(credentialsProvider, { url });
        if (status === 410) return fullSync(credentialsProvider, persist, folderId);
        for (const item of (data.value ?? [])) {
          if (imported >= MAX_SYNC_MESSAGES) break;
          await persist(normalizeMessage(item));
          imported += 1;
        }
        deltaLink = data['@odata.deltaLink'] ?? deltaLink;
        url = data['@odata.nextLink'] ?? null;
      }
      return Object.freeze({ deltaLink, imported, resynced: false });
    },

    async listFolders({ credentialsProvider } = {}) {
      if (typeof credentialsProvider !== 'function') throw new TypeError('microsoft_folders_request_invalid');
      const { data } = await call(credentialsProvider, { url: `${GRAPH_BASE}/me/mailFolders` });
      return Object.freeze((data.value ?? []).map((folder) => Object.freeze({
        id: folder.id, displayName: folder.displayName, unreadItemCount: folder.unreadItemCount ?? 0,
      })));
    },

    async createDraft({ credentialsProvider, to, subject, text } = {}) {
      if (typeof credentialsProvider !== 'function' || !Array.isArray(to) || to.length < 1
        || to.some((address) => typeof address !== 'string' || !address.includes('@'))
        || typeof subject !== 'string' || typeof text !== 'string' || text.length < 1) {
        throw new TypeError('microsoft_draft_request_invalid');
      }
      const { data } = await call(credentialsProvider, {
        url: `${GRAPH_BASE}/me/messages`,
        method: 'POST',
        body: {
          subject,
          body: { contentType: 'Text', content: text },
          toRecipients: to.map((address) => ({ emailAddress: { address } })),
        },
      });
      if (typeof data.id !== 'string') throw new Error('microsoft_draft_response_invalid');
      return Object.freeze({ draftId: data.id });
    },

    async send({ credentialsProvider, draftId } = {}) {
      if (typeof credentialsProvider !== 'function' || typeof draftId !== 'string' || draftId.length < 1) {
        throw new TypeError('microsoft_send_request_invalid');
      }
      const { status } = await call(credentialsProvider, { url: `${GRAPH_BASE}/me/messages/${draftId}/send`, method: 'POST' });
      if (status < 200 || status > 299) throw new Error('microsoft_send_response_invalid');
      return Object.freeze({ state: 'accepted_by_provider', providerMessageId: draftId });
    },

    async markRead({ credentialsProvider, messageId } = {}) {
      if (typeof credentialsProvider !== 'function') throw new TypeError('microsoft_mark_read_request_invalid');
      const { data } = await call(credentialsProvider, {
        url: `${GRAPH_BASE}/me/messages/${graphMessagePath(messageId, 'microsoft_mark_read_request_invalid')}`,
        method: 'PATCH',
        body: { isRead: true },
      });
      if (data?.id !== messageId || data?.isRead !== true) throw new Error('microsoft_mark_read_unconfirmed');
      return Object.freeze({ state: 'state_confirmed', providerMessageId: messageId });
    },

    async archive({ credentialsProvider, messageId } = {}) {
      if (typeof credentialsProvider !== 'function') throw new TypeError('microsoft_archive_request_invalid');
      const { status, data } = await call(credentialsProvider, {
        url: `${GRAPH_BASE}/me/messages/${graphMessagePath(messageId, 'microsoft_archive_request_invalid')}/move`,
        method: 'POST',
        body: { destinationId: 'archive' },
      });
      if (status !== 201 || typeof data?.id !== 'string' || data.id.length < 1) {
        throw new Error('microsoft_archive_unconfirmed');
      }
      const providerMessageId = data.id;
      const { data: observed } = await call(credentialsProvider, {
        url: `${GRAPH_BASE}/me/mailFolders/archive/messages/${graphMessagePath(providerMessageId, 'microsoft_archive_unconfirmed')}`,
      });
      if (observed?.id !== providerMessageId) throw new Error('microsoft_archive_unconfirmed');
      return Object.freeze({ state: 'state_confirmed', providerMessageId });
    },
  });
}
