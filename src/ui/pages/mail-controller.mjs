const DIGEST = /^sha256:[a-f0-9]{64}$/u;

function safeSuggestedName(value, digest) {
  const fallback = `${digest.slice(0, 18).replace(':', '-')}.bin`;
  const normalized = String(value ?? '').replace(/[<>:"/\\|?*\u0000-\u001f]/gu, '_').trim().slice(0, 180);
  return normalized || fallback;
}

export function createMailController({
  mailAccountStore,
  mailSyncService,
  mailService,
  searchMessages,
  attachmentRepository = null,
  confirmLocal = null,
  selectAttachmentExportPath = null,
  writer = null,
} = {}) {
  if (!mailAccountStore?.listStatus || !mailSyncService?.pause || !mailSyncService?.resume
    || !mailService?.propose || !mailService?.commit) {
    throw new TypeError('mail_controller_dependencies_required');
  }

  async function exportAttachment({ digest, suggestedName } = {}) {
    if (!DIGEST.test(digest ?? '')) throw new TypeError('mail_attachment_export_digest_invalid');
    if (!attachmentRepository?.getAttachmentBytes || typeof confirmLocal !== 'function'
      || typeof selectAttachmentExportPath !== 'function' || !writer?.writeAtomic) {
      throw new Error('mail_attachment_export_not_configured');
    }
    const confirmed = await confirmLocal({
      reason: 'Exporter cette pièce jointe e-mail vers un fichier local.',
      action: { name: 'mail.attachment.export', digest },
    });
    if (!Boolean(confirmed?.approved ?? confirmed)) throw new Error('mail_attachment_export_refused');
    const content = await attachmentRepository.getAttachmentBytes(digest);
    if (!Buffer.isBuffer(content) || content.length < 1) throw new Error('mail_attachment_blob_missing');
    const path = await selectAttachmentExportPath({ digest, suggestedName: safeSuggestedName(suggestedName, digest) });
    if (typeof path !== 'string' || path.length === 0) throw new Error('mail_attachment_export_cancelled');
    const written = await writer.writeAtomic({ path, content, encoding: null });
    return Object.freeze({ exported: true, digest, path, bytes: written?.bytes ?? content.length });
  }

  return Object.freeze({
    listAccounts: () => mailAccountStore.listStatus(),
    pauseAccount: (accountId) => mailSyncService.pause(accountId),
    resumeAccount: (accountId) => mailSyncService.resume(accountId),
    search: (query) => (typeof searchMessages === 'function' ? searchMessages(query) : Promise.resolve([])),
    proposeDraft: (request) => mailService.propose({ ...request, action: 'create_draft' }),
    proposeSend: (request) => mailService.propose({ ...request, action: 'send' }),
    commit: (proposalId) => mailService.commit({ proposalId }),
    exportAttachment,
  });
}
