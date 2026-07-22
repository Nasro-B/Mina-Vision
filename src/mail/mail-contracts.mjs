const PROVIDERS = new Set(['gmail', 'microsoft', 'imap-smtp']);
const MODES = new Set([1, 2, 3]);
const ID = /^[A-Za-z0-9._:-]{1,160}$/u;

export function validateMailAccount(account) {
  if (!ID.test(account?.id ?? '') || !PROVIDERS.has(account?.provider)
    || typeof account?.address !== 'string' || !account.address.includes('@') || account.address.length > 320
    || !Array.isArray(account?.capabilities) || !MODES.has(account?.mode)
    || !account?.syncState || typeof account.syncState !== 'object' || Array.isArray(account.syncState)) {
    throw new TypeError('mail_account_invalid');
  }
  return Object.freeze({
    id: account.id,
    provider: account.provider,
    address: account.address,
    capabilities: Object.freeze([...account.capabilities]),
    mode: account.mode,
    syncState: Object.freeze({ ...account.syncState }),
  });
}

/**
 * Cross-provider message identity + dedup key, per the synchronization rules in the
 * email gateway spec: Gmail dedups by message id + threadId (historyId only advances the
 * cursor, it never changes identity); Microsoft dedups by id + internetMessageId (the delta
 * cursor is not part of identity either); IMAP dedups by account/folder/UIDVALIDITY/UID,
 * carrying Message-ID and a canonical digest for the UIDVALIDITY-changed reconciliation path.
 */
export function normalizeMessageIdentity(input) {
  const provider = input?.provider;
  if (provider === 'gmail') {
    if (!ID.test(input.gmailId ?? '') || !ID.test(input.threadId ?? '')) throw new TypeError('mail_message_identity_invalid');
    return Object.freeze({
      provider, dedupKey: `gmail:${input.gmailId}:${input.threadId}`, gmailId: input.gmailId, threadId: input.threadId,
    });
  }
  if (provider === 'microsoft') {
    if (!ID.test(input.graphId ?? '') || typeof input.internetMessageId !== 'string' || input.internetMessageId.length < 3) {
      throw new TypeError('mail_message_identity_invalid');
    }
    return Object.freeze({
      provider, dedupKey: `microsoft:${input.graphId}:${input.internetMessageId}`,
      graphId: input.graphId, internetMessageId: input.internetMessageId,
    });
  }
  if (provider === 'imap-smtp') {
    if (!ID.test(input.accountId ?? '') || typeof input.folder !== 'string' || input.folder.length < 1
      || !/^\d+$/u.test(String(input.uidValidity ?? '')) || !Number.isSafeInteger(input.uid) || input.uid < 1) {
      throw new TypeError('mail_message_identity_invalid');
    }
    return Object.freeze({
      provider,
      dedupKey: `imap-smtp:${input.accountId}:${input.folder}:${input.uidValidity}:${input.uid}`,
      accountId: input.accountId,
      folder: input.folder,
      uidValidity: String(input.uidValidity),
      uid: input.uid,
      messageIdHeader: typeof input.messageIdHeader === 'string' ? input.messageIdHeader : null,
      digest: typeof input.digest === 'string' ? input.digest : null,
    });
  }
  throw new TypeError('mail_message_identity_invalid');
}
