import { quarantineAttachment } from './attachment-quarantine.mjs';

const ACCOUNT_ID = /^[A-Za-z0-9._:-]{1,160}$/u;

export function createMailSyncService({ repository, adapters, quarantine = quarantineAttachment } = {}) {
  if (!repository?.saveMessage || !repository?.getCursor || !repository?.saveCursor || !repository?.setPaused
    || !adapters || typeof adapters !== 'object') {
    throw new TypeError('mail_sync_service_dependencies_required');
  }

  function adapterFor(accountId) {
    if (!ACCOUNT_ID.test(accountId ?? '')) throw new TypeError('mail_sync_account_invalid');
    const adapter = adapters[accountId];
    if (!adapter?.sync) throw new Error('mail_sync_adapter_missing');
    return adapter;
  }

  async function persistAttachments(messageId, attachments) {
    for (const attachment of attachments ?? []) {
      const inspected = await quarantine({
        bytes: attachment.bytes, declaredFilename: attachment.filename, declaredContentType: attachment.contentType,
      });
      await repository.saveAttachment({
        digest: inspected.digest, detectedType: inspected.detectedType, status: inspected.status,
        sizeBytes: attachment.bytes.length,
      });
      await repository.linkAttachment({ messageId, digest: inspected.digest, declaredFilename: inspected.declaredFilename });
    }
  }

  async function syncAccount(accountId) {
    const adapter = adapterFor(accountId);
    const { cursor, paused } = repository.getCursor(accountId);
    if (paused) return Object.freeze({ paused: true, newMessages: 0, duplicateMessages: 0 });

    let newMessages = 0;
    let duplicateMessages = 0;
    const syncResult = await adapter.sync({
      cursor,
      persist: async (message) => {
        const saved = await repository.saveMessage({ ...message, accountId });
        if (saved.duplicate) {
          duplicateMessages += 1;
          return;
        }
        newMessages += 1;
        await persistAttachments(saved.messageId, message.attachments);
      },
    });
    await repository.saveCursor({ accountId, cursor: syncResult });
    return Object.freeze({ paused: false, newMessages, duplicateMessages });
  }

  async function pause(accountId) {
    if (!ACCOUNT_ID.test(accountId ?? '')) throw new TypeError('mail_sync_account_invalid');
    await repository.setPaused(accountId, true);
  }

  async function resume(accountId) {
    if (!ACCOUNT_ID.test(accountId ?? '')) throw new TypeError('mail_sync_account_invalid');
    await repository.setPaused(accountId, false);
  }

  return Object.freeze({ syncAccount, pause, resume });
}
