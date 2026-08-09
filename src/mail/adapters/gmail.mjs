import { GMAIL_SCOPES } from '../oauth/google-oauth.mjs';
import { MAX_ATTACHMENT_BYTES } from '../attachment-quarantine.mjs';

const ID = /^[A-Za-z0-9._:-]{1,160}$/u;
const MAX_SYNC_MESSAGES = 100;
const MAX_ATTACHMENTS_PER_MESSAGE = 100;
const BASE_URL = 'https://gmail.googleapis.com/gmail/v1/users/me';
const FORBIDDEN_FULL_SCOPE = 'https://mail.google.com/';
const BASE64URL = /^[A-Za-z0-9_-]+={0,2}$/u;

function headerValue(headers, name) {
  return headers.find((header) => header.name?.toLowerCase() === name)?.value ?? null;
}

function normalizeMessage(raw, attachments = []) {
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
    attachments: Object.freeze(attachments),
    trust: 'external_untrusted',
  });
}

function attachmentCandidates(payload) {
  const candidates = [];
  function visit(part) {
    if (!part || typeof part !== 'object') return;
    const filename = typeof part.filename === 'string' ? part.filename.slice(0, 500) : '';
    const body = part.body;
    if (filename) {
      const size = Number(body?.size);
      if (!Number.isSafeInteger(size) || size < 1) throw new Error('gmail_attachment_invalid');
      if (size > MAX_ATTACHMENT_BYTES) throw new Error('gmail_attachment_too_large');
      const attachmentId = body?.attachmentId;
      const data = body?.data;
      if (typeof attachmentId !== 'string' && typeof data !== 'string') throw new Error('gmail_attachment_invalid');
      if (typeof attachmentId === 'string' && !ID.test(attachmentId)) throw new Error('gmail_attachment_invalid');
      candidates.push(Object.freeze({
        attachmentId: typeof attachmentId === 'string' ? attachmentId : null,
        data: typeof data === 'string' ? data : null,
        filename,
        contentType: typeof part.mimeType === 'string' && part.mimeType.length > 0
          ? part.mimeType.slice(0, 200)
          : 'application/octet-stream',
        size,
      }));
    }
    for (const child of Array.isArray(part.parts) ? part.parts : []) visit(child);
  }
  visit(payload);
  if (candidates.length > MAX_ATTACHMENTS_PER_MESSAGE) throw new Error('gmail_attachment_count_exceeded');
  return candidates;
}

function decodeAttachment(data, expectedSize) {
  if (typeof data !== 'string' || !BASE64URL.test(data)) throw new Error('gmail_attachment_payload_invalid');
  const canonical = data.replace(/=+$/u, '');
  const bytes = Buffer.from(canonical, 'base64url');
  if (bytes.length !== expectedSize || bytes.length < 1 || bytes.length > MAX_ATTACHMENT_BYTES
    || bytes.toString('base64url') !== canonical) {
    throw new Error('gmail_attachment_payload_invalid');
  }
  return bytes;
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

  async function loadAttachments(credentialsProvider, raw) {
    const attachments = [];
    for (const candidate of attachmentCandidates(raw?.payload)) {
      let data = candidate.data;
      if (data === null) {
        const { response } = await call(credentialsProvider, {
          url: `${BASE_URL}/messages/${encodeURIComponent(raw.id)}/attachments/${encodeURIComponent(candidate.attachmentId)}`,
        });
        if (response.data?.size != null && Number(response.data.size) !== candidate.size) {
          throw new Error('gmail_attachment_size_mismatch');
        }
        data = response.data?.data;
      }
      attachments.push(Object.freeze({
        filename: candidate.filename,
        contentType: candidate.contentType,
        bytes: decodeAttachment(data, candidate.size),
      }));
    }
    return Object.freeze(attachments);
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
      const message = normalizeMessage(full.data, await loadAttachments(credentialsProvider, full.data));
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
        await persist(normalizeMessage(full.data, await loadAttachments(credentialsProvider, full.data)));
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
    capabilities: Object.freeze(['sync', 'listThreads', 'listLabels', 'createDraft', 'send', 'markRead', 'archive', 'label', 'move', 'trash', 'markSpam']),

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

    async label({ credentialsProvider, messageId, addLabelIds = [], removeLabelIds = [] } = {}) {
      if (typeof credentialsProvider !== 'function' || !ID.test(messageId ?? '')
        || !Array.isArray(addLabelIds) || !Array.isArray(removeLabelIds)
        || addLabelIds.length + removeLabelIds.length < 1 || addLabelIds.length + removeLabelIds.length > 100
        || [...addLabelIds, ...removeLabelIds].some((labelId) => !ID.test(labelId))
        || new Set(addLabelIds).size !== addLabelIds.length
        || new Set(removeLabelIds).size !== removeLabelIds.length
        || addLabelIds.some((labelId) => removeLabelIds.includes(labelId))) {
        throw new TypeError('gmail_label_request_invalid');
      }
      const { response } = await call(credentialsProvider, {
        url: `${BASE_URL}/messages/${encodeURIComponent(messageId)}/modify`,
        method: 'POST',
        data: { addLabelIds, removeLabelIds },
      });
      const labels = response.data?.labelIds;
      if (response.data?.id !== messageId || !Array.isArray(labels)
        || addLabelIds.some((labelId) => !labels.includes(labelId))
        || removeLabelIds.some((labelId) => labels.includes(labelId))) {
        throw new Error('gmail_label_unconfirmed');
      }
      return Object.freeze({ state: 'state_confirmed', providerMessageId: messageId });
    },

    async move({ credentialsProvider, messageId, destinationLabelId, sourceLabelIds } = {}) {
      if (typeof credentialsProvider !== 'function' || !ID.test(messageId ?? '') || !ID.test(destinationLabelId ?? '')
        || !Array.isArray(sourceLabelIds) || sourceLabelIds.length < 1 || sourceLabelIds.length > 99
        || sourceLabelIds.some((labelId) => !ID.test(labelId))
        || sourceLabelIds.includes(destinationLabelId) || new Set(sourceLabelIds).size !== sourceLabelIds.length) {
        throw new TypeError('gmail_move_request_invalid');
      }
      const { response } = await call(credentialsProvider, {
        url: `${BASE_URL}/messages/${encodeURIComponent(messageId)}/modify`,
        method: 'POST',
        data: { addLabelIds: [destinationLabelId], removeLabelIds: sourceLabelIds },
      });
      const labels = response.data?.labelIds;
      if (response.data?.id !== messageId || !Array.isArray(labels) || !labels.includes(destinationLabelId)
        || sourceLabelIds.some((labelId) => labels.includes(labelId))) {
        throw new Error('gmail_move_unconfirmed');
      }
      return Object.freeze({ state: 'state_confirmed', providerMessageId: messageId });
    },

    async trash({ credentialsProvider, messageId } = {}) {
      if (typeof credentialsProvider !== 'function' || !ID.test(messageId ?? '')) {
        throw new TypeError('gmail_trash_request_invalid');
      }
      const { response } = await call(credentialsProvider, {
        url: `${BASE_URL}/messages/${encodeURIComponent(messageId)}/trash`,
        method: 'POST',
      });
      if (response.data?.id !== messageId || !Array.isArray(response.data?.labelIds)
        || !response.data.labelIds.includes('TRASH')) {
        throw new Error('gmail_trash_unconfirmed');
      }
      return Object.freeze({ state: 'state_confirmed', providerMessageId: messageId });
    },

    async markSpam({ credentialsProvider, messageId } = {}) {
      if (typeof credentialsProvider !== 'function' || !ID.test(messageId ?? '')) {
        throw new TypeError('gmail_mark_spam_request_invalid');
      }
      const { response } = await call(credentialsProvider, {
        url: `${BASE_URL}/messages/${encodeURIComponent(messageId)}/modify`,
        method: 'POST',
        data: { addLabelIds: ['SPAM'] },
      });
      if (response.data?.id !== messageId || !Array.isArray(response.data?.labelIds)
        || !response.data.labelIds.includes('SPAM')) {
        throw new Error('gmail_mark_spam_unconfirmed');
      }
      return Object.freeze({ state: 'state_confirmed', providerMessageId: messageId });
    },
  });
}
