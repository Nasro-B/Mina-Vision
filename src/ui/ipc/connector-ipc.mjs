export function registerConnectorIpc({ ipcMain, controller } = {}) {
  if (!ipcMain?.handle || !controller) throw new TypeError('connector_ipc_dependencies_required');
  ipcMain.handle('mina:connectors:list', () => controller.list());
  ipcMain.handle('mina:connectors:import', (_event, payload) => controller.importPackage(payload?.path));
  ipcMain.handle('mina:connectors:inspect-job', (_event, payload) => controller.inspectJob(payload?.jobId));
  ipcMain.handle('mina:connectors:install', (_event, payload) => controller.install(payload?.jobId));
  ipcMain.handle('mina:connectors:approve-publisher', (_event, payload) => controller.approvePublisher(payload));
  ipcMain.handle('mina:connectors:publisher-trust', (_event, payload) => controller.publisherTrust(payload?.publisherId));
  ipcMain.handle('mina:connectors:stage-update', (_event, payload) => controller.stageUpdate(payload?.path));
  ipcMain.handle('mina:connectors:permission-diff', (_event, payload) => controller.permissionDiff(payload?.connectorId));
  ipcMain.handle('mina:connectors:activate-version', (_event, payload) => controller.activateVersion(payload?.connectorId, payload?.options));
  ipcMain.handle('mina:connectors:rollback-version', (_event, payload) => controller.rollbackVersion(payload?.connectorId));
  ipcMain.handle('mina:connectors:revoke-publisher', (_event, payload) => controller.revokePublisher(payload?.publisherId));
}
