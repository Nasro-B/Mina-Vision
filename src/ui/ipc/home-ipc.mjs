function exact(value, fields, error) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== [...fields].sort().join(',')) throw new TypeError(error);
  return value;
}

export function registerHomeIpc({ ipcMain, controller } = {}) {
  if (!ipcMain?.handle || !controller) throw new TypeError('home_ipc_dependencies_required');
  ipcMain.handle('mina:home:connector-health', async () => controller.connectorHealth());
  ipcMain.handle('mina:home:request-permission', async (_event, payload) => (
    controller.requestPermission(exact(payload, ['connectorId'], 'home_ui_request_invalid').connectorId)
  ));
  ipcMain.handle('mina:home:discover', async (_event, payload) => (
    controller.discover(exact(payload, ['connectorId'], 'home_ui_request_invalid').connectorId)
  ));
  ipcMain.handle('mina:home:list', async () => controller.list());
  ipcMain.handle('mina:home:resolve', async (_event, payload) => controller.resolve(payload));
  ipcMain.handle('mina:home:edit-device', async (_event, payload) => (
    controller.editDevice(exact(payload, ['deviceId', 'patch', 'confirmedLocally'], 'home_ui_request_invalid'))
  ));
  ipcMain.handle('mina:home:execute', async (_event, payload) => controller.execute(payload));
  ipcMain.handle('mina:home:audit-history', async (_event, payload) => (
    controller.auditHistory(exact(payload, ['commandId'], 'home_ui_request_invalid').commandId)
  ));
}
