function payload(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('analytics_ipc_payload_invalid');
  return value;
}

export function registerAnalyticsIpc({ ipcMain, controller } = {}) {
  if (!ipcMain?.handle || !controller?.query || !controller?.budgetSnapshot || !controller?.export) {
    throw new TypeError('analytics_ipc_dependencies_required');
  }
  const channels = Object.freeze([
    ['mina:analytics:query', async (_event, value) => controller.query(payload(value))],
    ['mina:analytics:budgets', async (_event, value) => controller.budgetSnapshot(payload(value))],
    ['mina:analytics:export', async (_event, value) => controller.export(payload(value))],
  ]);
  for (const [channel, handler] of channels) ipcMain.handle(channel, handler);
  return Object.freeze({
    dispose() {
      for (const [channel] of channels) ipcMain.removeHandler?.(channel);
    },
  });
}
