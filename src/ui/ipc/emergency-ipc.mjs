export function registerEmergencyIpc({ ipcMain, controller } = {}) {
  if (!ipcMain?.handle || !controller) throw new TypeError('emergency_ipc_dependencies_required');
  ipcMain.handle('mina:emergency:build', (_event, payload) => controller.buildCorpus(payload));
  ipcMain.handle('mina:emergency:verify', (_event, payload) => controller.verifyCorpus(payload));
  ipcMain.handle('mina:emergency:activate', (_event, payload) => controller.activate(payload));
  ipcMain.handle('mina:emergency:deactivate', () => controller.deactivate());
  ipcMain.handle('mina:emergency:search', (_event, payload) => controller.search(payload));
  ipcMain.handle('mina:emergency:status', () => controller.status());
}
