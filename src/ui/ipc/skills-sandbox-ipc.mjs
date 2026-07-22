function exact(value, fields, error) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== [...fields].sort().join(',')) throw new TypeError(error);
  return value;
}

export function registerSkillsSandboxIpc({ ipcMain, controller } = {}) {
  if (!ipcMain?.handle || !controller) throw new TypeError('skills_sandbox_ipc_dependencies_required');
  ipcMain.handle('mina:skills-sandbox:status', () => controller.status());
  ipcMain.handle('mina:skills:choose-stage', () => controller.chooseAndStageSkill());
  ipcMain.handle('mina:skills:install', async (_event, payload) => (
    controller.installSkill(exact(payload, ['quarantineId'], 'skills_ui_request_invalid'))
  ));
  ipcMain.handle('mina:sandbox:execute', async (_event, payload) => (
    controller.executeSandbox(exact(payload, ['proposalId'], 'sandbox_ui_request_invalid'))
  ));
  ipcMain.handle('mina:sandbox:cancel', async (_event, payload) => (
    controller.cancelSandbox(exact(payload, ['jobId'], 'sandbox_ui_request_invalid'))
  ));
  ipcMain.handle('mina:sandbox:import-artifact', async (_event, payload) => (
    controller.importArtifact(exact(payload, ['jobId', 'artifactId'], 'sandbox_ui_request_invalid'))
  ));
}
