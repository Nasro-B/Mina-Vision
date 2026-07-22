export function registerApprovalIpc({ ipcMain, controller } = {}) {
  if (!ipcMain?.handle || !controller) throw new TypeError('approval_ipc_dependencies_required');
  ipcMain.handle('mina:approvals:remote-approve', (_event, payload) => controller.remoteApprove(payload));
  ipcMain.handle('mina:approvals:approve', (_event, payload) => controller.approve(payload));
  ipcMain.handle('mina:approvals:deny', (_event, payload) => controller.deny(payload));
  ipcMain.handle('mina:approvals:consume', (_event, payload) => controller.consume(payload?.approvalId));
  ipcMain.handle('mina:approvals:get', (_event, payload) => controller.get(payload?.approvalId));
}
