export function registerAutomationIpc({ ipcMain, controller } = {}) {
  if (!ipcMain?.handle || !controller) throw new TypeError('automation_ipc_dependencies_required');
  ipcMain.handle('mina:automation:list-definitions', () => controller.listDefinitions());
  ipcMain.handle('mina:automation:get-definition', (_event, payload) => controller.getDefinition(payload));
  ipcMain.handle('mina:automation:create-definition', (_event, payload) => controller.createDefinition(payload));
  ipcMain.handle('mina:automation:transition-definition', (_event, payload) => controller.transitionDefinition(payload));
  ipcMain.handle('mina:automation:create-grant', (_event, payload) => controller.createGrant(payload));
  ipcMain.handle('mina:automation:simulate', (_event, payload) => controller.simulate(payload));
  ipcMain.handle('mina:automation:evaluate', (_event, payload) => controller.evaluate(payload));
  ipcMain.handle('mina:automation:get-run', (_event, payload) => controller.getRun(payload));
  ipcMain.handle('mina:automation:list-runs', (_event, payload) => controller.listRuns(payload));
  ipcMain.handle('mina:health:snapshot', () => controller.healthSnapshot());
}
