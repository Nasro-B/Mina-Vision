export function registerRecoveryIpc({ ipcMain, controller } = {}) {
  if (!ipcMain?.handle || !controller) throw new TypeError('recovery_ipc_dependencies_required');
  ipcMain.handle('mina:recovery:list-cases', (_event, payload) => controller.listCases(payload));
  ipcMain.handle('mina:recovery:reconcile', (_event, payload) => controller.reconcileCase(payload));
  ipcMain.handle('mina:recovery:propose-next-action', (_event, payload) => controller.proposeNextAction(payload));
  ipcMain.handle('mina:recovery:close-manually', (_event, payload) => controller.closeManually(payload));
}
