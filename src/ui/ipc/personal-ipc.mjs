export function registerPersonalIpc({ ipcMain, controller = {} } = {}) {
  if (!ipcMain?.handle) throw new TypeError('personal_ipc_dependencies_required');
  const { today, graph } = controller;

  if (today) {
    ipcMain.handle('mina:personal:briefing', (_event, payload) => today.getBriefing(payload));
    ipcMain.handle('mina:personal:calendar-events', (_event, payload) => today.listCalendarEvents(payload));
    ipcMain.handle('mina:personal:tasks', () => today.listTasks());
    ipcMain.handle('mina:routines:list', () => today.listRoutines());
    ipcMain.handle('mina:routines:set-status', (_event, payload) => today.setRoutineStatus(payload));
  }

  if (graph) {
    ipcMain.handle('mina:graph:subgraph', (_event, payload) => graph.getSubgraph(payload));
    ipcMain.handle('mina:graph:upsert-entity', (_event, payload) => graph.upsertEntity(payload));
    ipcMain.handle('mina:graph:propose-edge', (_event, payload) => graph.proposeEdge(payload));
    ipcMain.handle('mina:graph:confirm-edge', (_event, payload) => graph.confirmEdge(payload));
    ipcMain.handle('mina:graph:dispute-edge', (_event, payload) => graph.disputeEdge(payload));
    ipcMain.handle('mina:graph:forget-entity', (_event, payload) => graph.forgetEntity(payload));
    ipcMain.handle('mina:graph:resolve-entity', (_event, payload) => graph.resolveEntity(payload));
    ipcMain.handle('mina:graph:list-contacts', () => graph.listContacts());
    ipcMain.handle('mina:graph:resolve-contact-endpoint', (_event, payload) => graph.resolveContactEndpoint(payload));
  }
}
