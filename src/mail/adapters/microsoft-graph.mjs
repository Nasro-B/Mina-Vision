import { MAX_ATTACHMENT_BYTES } from '../attachment-quarantine.mjs';

const ID = /^[A-Za-z0-9._:-]{1,160}$/u;
const MAX_SYNC_MESSAGES = 100;
const MAX_ATTACHMENTS_PER_MESSAGE = 100;
const MAX_THROTTLE_RETRIES = 3;
const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

function isCategoryName(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 255 && !/[\u0000\r\n]/u.test(value);
}

function sameStringSet(left, right) {
  return left.length === right.length && left.every((value) => right.includes(value));
}

function isRemovedMessage(value) {
  return value?.['@removed'] != null;
}

function normalizeMessage(raw, attachments = []) {
  if (typeof raw?.id !== 'string' || raw.id.length < 1) throw new Error('microsoft_message_invalid');
  return Object.freeze({
    provider: 'microsoft',
    providerMessageId: raw.id,
    internetMessageId: typeof raw.internetMessageId === 'string' ? raw.internetMessageId : null,
    subject: String(raw.subject ?? '').slice(0, 998),
    receivedAt: typeof raw.receivedDateTime === 'string' ? raw.receivedDateTime : null,
    bodyText: String(raw.body?.content ?? '').slice(0, 2_000_000),
    attachments: Object.freeze(attachments),
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

function attachmentCandidates(value) {
  const candidates = [];
  for (const attachment of Array.isArray(value) ? value : []) {
    if (attachment?.['@odata.type'] !== '#microsoft.graph.fileAttachment') continue;
    const size = Number(attachment.size);
    if (!Number.isSafeInteger(size) || size < 1) throw new Error('microsoft_attachment_invalid');
    if (size > MAX_ATTACHMENT_BYTES) throw new Error('microsoft_attachment_too_large');
    const attachmentId = graphMessagePath(attachment.id, 'microsoft_attachment_invalid');
    const filename = typeof attachment.name === 'string' ? attachment.name.slice(0, 500) : '';
    if (!filename) throw new Error('microsoft_attachment_invalid');
    candidates.push(Object.freeze({
      attachmentId,
      filename,
      contentType: typeof attachment.contentType === 'string' && attachment.contentType.length > 0
        ? attachment.contentType.slice(0, 200)
        : 'application/octet-stream',
      size,
    }));
    if (candidates.length > MAX_ATTACHMENTS_PER_MESSAGE) throw new Error('microsoft_attachment_count_exceeded');
  }
  return candidates;
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

  async function request(credentialsProvider, { url, method = 'GET', body } = {}, attempt = 0) {
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
      return request(credentialsProvider, { url, method, body }, attempt + 1);
    }
    if (response.status >= 400 && response.status !== 410) {
      throw Object.assign(new Error(`microsoft_graph_request_failed:${response.status}`), { status: response.status });
    }
    return { status: response.status, response };
  }

  async function call(credentialsProvider, options) {
    const { status, response } = await request(credentialsProvider, options);
    return { status, data: await parseJson(response) };
  }

  async function callBytes(credentialsProvider, options) {
    const { status, response } = await request(credentialsProvider, options);
    const contentLength = response.headers?.get?.('Content-Length');
    if (contentLength !== null && contentLength !== undefined && contentLength !== '') {
      const size = Number(contentLength);
      if (!Number.isSafeInteger(size) || size < 1) throw new Error('microsoft_attachment_payload_invalid');
      if (size > MAX_ATTACHMENT_BYTES) throw new Error('microsoft_attachment_too_large');
    }
    if (typeof response.arrayBuffer !== 'function') throw new Error('microsoft_attachment_payload_invalid');
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length < 1 || bytes.length > MAX_ATTACHMENT_BYTES) throw new Error('microsoft_attachment_payload_invalid');
    return { status, bytes };
  }

  async function loadAttachments(credentialsProvider, raw) {
    const messageId = graphMessagePath(raw?.id, 'microsoft_attachment_invalid');
    let url = `${GRAPH_BASE}/me/messages/${messageId}/attachments`;
    const attachments = [];
    while (url) {
      const { data } = await call(credentialsProvider, { url });
      for (const candidate of attachmentCandidates(data.value)) {
        const { bytes } = await callBytes(credentialsProvider, {
          url: `${GRAPH_BASE}/me/messages/${messageId}/attachments/${candidate.attachmentId}/$value`,
        });
        if (bytes.length !== candidate.size) throw new Error('microsoft_attachment_size_mismatch');
        attachments.push(Object.freeze({
          filename: candidate.filename,
          contentType: candidate.contentType,
          bytes,
        }));
      }
      if (attachments.length > MAX_ATTACHMENTS_PER_MESSAGE) throw new Error('microsoft_attachment_count_exceeded');
      url = data['@odata.nextLink'] ?? null;
    }
    return Object.freeze(attachments);
  }

  async function fullSync(credentialsProvider, persist, folderId) {
    let url = `${GRAPH_BASE}/me/mailFolders/${folderId}/messages/delta`;
    let deltaLink = null;
    let imported = 0;
    while (url && imported < MAX_SYNC_MESSAGES) {
      const { data } = await call(credentialsProvider, { url });
      for (const item of (data.value ?? [])) {
        if (imported >= MAX_SYNC_MESSAGES) break;
        if (isRemovedMessage(item)) continue;
        await persist(normalizeMessage(item, await loadAttachments(credentialsProvider, item)));
        imported += 1;
      }
      deltaLink = data['@odata.deltaLink'] ?? deltaLink;
      url = data['@odata.nextLink'] ?? null;
    }
    return Object.freeze({ deltaLink, imported, resynced: true });
  }

  async function moveAndVerify(credentialsProvider, messageId, destinationId, requestError, unconfirmedError) {
    const sourcePath = graphMessagePath(messageId, requestError);
    const destinationPath = graphMessagePath(destinationId, requestError);
    const { status, data } = await call(credentialsProvider, {
      url: `${GRAPH_BASE}/me/messages/${sourcePath}/move`,
      method: 'POST',
      body: { destinationId },
    });
    if (status !== 201 || typeof data?.id !== 'string' || data.id.length < 1) {
      throw new Error(unconfirmedError);
    }
    const providerMessageId = data.id;
    const { data: observed } = await call(credentialsProvider, {
      url: `${GRAPH_BASE}/me/mailFolders/${destinationPath}/messages/${graphMessagePath(providerMessageId, unconfirmedError)}`,
    });
    if (observed?.id !== providerMessageId) throw new Error(unconfirmedError);
    return Object.freeze({ state: 'state_confirmed', providerMessageId });
  }

  async function readMessageCategories(credentialsProvider, messageId, error) {
    const { data } = await call(credentialsProvider, {
      url: `${GRAPH_BASE}/me/messages/${graphMessagePath(messageId, error)}?%24select=id%2Ccategories`,
    });
    const categories = data?.categories ?? [];
    if (data?.id !== messageId || !Array.isArray(categories) || categories.some((category) => !isCategoryName(category))) {
      throw new Error(error);
    }
    return [...new Set(categories)];
  }

  return Object.freeze({
    id: account.id,
    provider: 'microsoft',
    capabilities: Object.freeze(['sync', 'listFolders', 'createDraft', 'send', 'markRead', 'archive', 'move', 'label', 'trash']),

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
          if (isRemovedMessage(item)) continue;
          await persist(normalizeMessage(item, await loadAttachments(credentialsProvider, item)));
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
      return moveAndVerify(credentialsProvider, messageId, 'archive', 'microsoft_archive_request_invalid', 'microsoft_archive_unconfirmed');
    },

    async move({ credentialsProvider, messageId, destinationId } = {}) {
      if (typeof credentialsProvider !== 'function') throw new TypeError('microsoft_move_request_invalid');
      return moveAndVerify(credentialsProvider, messageId, destinationId, 'microsoft_move_request_invalid', 'microsoft_move_unconfirmed');
    },

    async label({ credentialsProvider, messageId, addCategories = [], removeCategories = [] } = {}) {
      if (typeof credentialsProvider !== 'function' || !Array.isArray(addCategories) || !Array.isArray(removeCategories)
        || addCategories.length + removeCategories.length < 1 || addCategories.length + removeCategories.length > 100
        || [...addCategories, ...removeCategories].some((category) => !isCategoryName(category))
        || new Set(addCategories).size !== addCategories.length || new Set(removeCategories).size !== removeCategories.length
        || addCategories.some((category) => removeCategories.includes(category))) {
        throw new TypeError('microsoft_label_request_invalid');
      }
      const messagePath = graphMessagePath(messageId, 'microsoft_label_request_invalid');
      if (addCategories.length > 0) {
        const { data } = await call(credentialsProvider, { url: `${GRAPH_BASE}/me/outlook/masterCategories` });
        const masterCategories = new Set((data?.value ?? [])
          .map((category) => category?.displayName)
          .filter((category) => isCategoryName(category)));
        if (addCategories.some((category) => !masterCategories.has(category))) {
          throw new Error('microsoft_label_category_unavailable');
        }
      }
      const current = await readMessageCategories(credentialsProvider, messageId, 'microsoft_label_unconfirmed');
      const next = [...current.filter((category) => !removeCategories.includes(category))];
      for (const category of addCategories) if (!next.includes(category)) next.push(category);
      if (sameStringSet(current, next)) {
        return Object.freeze({ state: 'state_confirmed', providerMessageId: messageId });
      }
      const { status, data } = await call(credentialsProvider, {
        url: `${GRAPH_BASE}/me/messages/${messagePath}`,
        method: 'PATCH',
        body: { categories: next },
      });
      if (status !== 200 || data?.id !== messageId) throw new Error('microsoft_label_unconfirmed');
      const observed = await readMessageCategories(credentialsProvider, messageId, 'microsoft_label_unconfirmed');
      if (!sameStringSet(observed, next)) throw new Error('microsoft_label_unconfirmed');
      return Object.freeze({ state: 'state_confirmed', providerMessageId: messageId });
    },

    async trash({ credentialsProvider, messageId } = {}) {
      if (typeof credentialsProvider !== 'function') throw new TypeError('microsoft_trash_request_invalid');
      return moveAndVerify(credentialsProvider, messageId, 'deleteditems', 'microsoft_trash_request_invalid', 'microsoft_trash_unconfirmed');
    },
  });
}
