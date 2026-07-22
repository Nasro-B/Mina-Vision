export function registerCameraIpc({ ipcMain, controller } = {}) {
  if (!ipcMain?.handle || !controller) throw new TypeError('camera_ipc_dependencies_required');
  ipcMain.handle('mina:camera:status', () => controller.status());
  ipcMain.handle('mina:camera:start', (_event, payload) => controller.start(payload));
  ipcMain.handle('mina:camera:stop', () => controller.stop());
  ipcMain.handle('mina:camera:switch-lens', (_event, payload) => controller.switchLens(payload));
  ipcMain.handle('mina:camera:preview-frame', () => controller.nextPreviewFrame());
  ipcMain.handle('mina:camera:enroll', (_event, payload) => controller.enroll(payload));
  ipcMain.handle('mina:camera:delete-profile', (_event, payload) => controller.deleteProfile(payload));
}
