export function registerPersonalityIpc({ ipcMain, controller } = {}) {
  if (!ipcMain?.handle || !controller) throw new TypeError('personality_ipc_dependencies_required');
  ipcMain.handle('mina:personality:get', () => controller.get());
  ipcMain.handle('mina:personality:propose-patch', (_event, payload) => controller.proposePatch(payload));
  ipcMain.handle('mina:personality:confirm-patch', (_event, payload) => controller.confirmPatch(payload?.patchId));
  ipcMain.handle('mina:personality:rollback', () => controller.rollback());
  ipcMain.handle('mina:personality:render-style-context', (_event, payload) => controller.renderStyleContext(payload?.channel));
}
