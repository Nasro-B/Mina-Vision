function exact(value, fields, error) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== [...fields].sort().join(',')) throw new TypeError(error);
  return value;
}

function objectWithOnly(value, fields, error) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some((key) => !fields.includes(key))) throw new TypeError(error);
  return value;
}

export function registerMailIpc({ ipcMain, controller } = {}) {
  if (!ipcMain?.handle || !controller) throw new TypeError('mail_ipc_dependencies_required');
  ipcMain.handle('mina:mail:list-accounts', () => controller.listAccounts());
  ipcMain.handle('mina:mail:pause', async (_event, payload) => (
    controller.pauseAccount(exact(payload, ['accountId'], 'mail_ui_request_invalid').accountId)
  ));
  ipcMain.handle('mina:mail:resume', async (_event, payload) => (
    controller.resumeAccount(exact(payload, ['accountId'], 'mail_ui_request_invalid').accountId)
  ));
  ipcMain.handle('mina:mail:search', async (_event, payload) => (
    controller.search(exact(payload, ['query'], 'mail_ui_request_invalid').query)
  ));
  ipcMain.handle('mina:mail:propose-draft', async (_event, payload) => controller.proposeDraft(payload));
  ipcMain.handle('mina:mail:propose-send', async (_event, payload) => controller.proposeSend(payload));
  ipcMain.handle('mina:mail:commit', async (_event, payload) => (
    controller.commit(exact(payload, ['proposalId'], 'mail_ui_request_invalid').proposalId)
  ));
  ipcMain.handle('mina:mail:export-attachment', async (_event, payload) => (
    controller.exportAttachment(objectWithOnly(payload, ['digest', 'suggestedName'], 'mail_ui_request_invalid'))
  ));
}
