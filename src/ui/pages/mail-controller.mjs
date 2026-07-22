export function createMailController({ mailAccountStore, mailSyncService, mailService, searchMessages } = {}) {
  if (!mailAccountStore?.listStatus || !mailSyncService?.pause || !mailSyncService?.resume
    || !mailService?.propose || !mailService?.commit) {
    throw new TypeError('mail_controller_dependencies_required');
  }

  return Object.freeze({
    listAccounts: () => mailAccountStore.listStatus(),
    pauseAccount: (accountId) => mailSyncService.pause(accountId),
    resumeAccount: (accountId) => mailSyncService.resume(accountId),
    search: (query) => (typeof searchMessages === 'function' ? searchMessages(query) : Promise.resolve([])),
    proposeDraft: (request) => mailService.propose({ ...request, action: 'create_draft' }),
    proposeSend: (request) => mailService.propose({ ...request, action: 'send' }),
    commit: (proposalId) => mailService.commit({ proposalId }),
  });
}
