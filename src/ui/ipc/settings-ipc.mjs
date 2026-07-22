const PROVIDER_ID = /^[A-Za-z][A-Za-z0-9-]{0,31}$/u;

function requireObject(value, error) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(error);
  return value;
}

function providerRequest(value) {
  const request = requireObject(value, 'settings_provider_invalid');
  if (!PROVIDER_ID.test(request.providerId ?? '')) throw new TypeError('settings_provider_invalid');
  return { providerId: request.providerId };
}

export function registerSettingsIpc({ ipcMain, controller } = {}) {
  if (!ipcMain?.handle || !controller) throw new TypeError('settings_ipc_dependencies_required');
  ipcMain.handle('mina:settings:get-schema', () => controller.getSchema());
  ipcMain.handle('mina:settings:get', () => controller.getState());
  ipcMain.handle('mina:settings:update', async (_event, payload) => {
    const patch = requireObject(payload, 'settings_update_invalid');
    if (Object.keys(patch).length > 30 || Object.values(patch).some((value) => !['string', 'boolean'].includes(typeof value))) {
      throw new TypeError('settings_update_invalid');
    }
    return controller.update(patch);
  });
  ipcMain.handle('mina:settings:set-secret', async (_event, payload) => {
    const request = providerRequest(payload);
    if (typeof payload.value !== 'string' || payload.value.length === 0 || Buffer.byteLength(payload.value) > 64 * 1024) {
      throw new TypeError('settings_secret_invalid');
    }
    return controller.setSecret({ ...request, value: payload.value });
  });
  ipcMain.handle('mina:settings:revoke-secret', (_event, payload) => controller.revokeSecret(providerRequest(payload)));
  ipcMain.handle('mina:settings:test-provider', (_event, payload) => controller.testProvider(providerRequest(payload)));
}
