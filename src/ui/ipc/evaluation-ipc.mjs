export function registerEvaluationIpc({ ipcMain, controller } = {}) {
  if (!ipcMain?.handle || !controller) throw new TypeError('evaluation_ipc_dependencies_required');
  ipcMain.handle('mina:evaluation:run-suite', (_event, payload) => controller.runSuite(payload));
  ipcMain.handle('mina:evaluation:compare', (_event, payload) => controller.compareRuns(payload));
}
