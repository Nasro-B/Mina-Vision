export function registerDocumentIpc({ ipcMain, controller } = {}) {
  if (!ipcMain?.handle || !controller) throw new TypeError('document_ipc_dependencies_required');
  ipcMain.handle('mina:documents:intake', (_event, payload) => controller.intakeDocument(payload));
  ipcMain.handle('mina:documents:get', (_event, payload) => controller.getDocument(payload));
  ipcMain.handle('mina:documents:list', () => controller.listDocuments());
  ipcMain.handle('mina:documents:promote', (_event, payload) => controller.promoteDocument(payload));
  ipcMain.handle('mina:documents:parse', (_event, payload) => controller.parseDocument(payload));
  ipcMain.handle('mina:documents:cancel-parse', (_event, payload) => controller.cancelParse(payload));
  ipcMain.handle('mina:documents:evidence', (_event, payload) => controller.listEvidence(payload));
  ipcMain.handle('mina:documents:propose-classification', (_event, payload) => controller.proposeClassificationForDocument(payload?.documentId, payload?.hints));
  ipcMain.handle('mina:documents:confirm-classification', (_event, payload) => controller.confirmClassification(payload?.proposalId, payload?.overrides));
  ipcMain.handle('mina:documents:index-selection', (_event, payload) => controller.indexSelection(payload));
  ipcMain.handle('mina:documents:forget', (_event, payload) => controller.forgetDocument(payload));
  ipcMain.handle('mina:documents:propose-fill', (_event, payload) => controller.proposeFill(payload));
  ipcMain.handle('mina:documents:render-form-preview', (_event, payload) => controller.renderFormPreview(payload));
  ipcMain.handle('mina:documents:commit-form-copy', (_event, payload) => controller.commitFormCopy(payload?.proposalId, payload?.options));
  ipcMain.handle('mina:documents:convert', (_event, payload) => controller.convertDocument(payload));
  ipcMain.handle('mina:documents:download', (_event, payload) => controller.downloadDocument(payload));
  // Les canaux d'impression sont débrayables : main.mjs garde ses handlers historiques qui
  // portent la CONFIRMATION locale (approbation d'imprimante, confirmation avant impression) —
  // les enregistrer ici en doublon ferait crasher l'app (second handler) et perdrait la
  // confirmation. registerPrinting: false dans le controller composé les laisse à main.mjs.
  if (controller.registerPrinting !== false) {
    ipcMain.handle('mina:printing:discover', () => controller.discoverPrinters());
    ipcMain.handle('mina:printing:approve', (_event, payload) => controller.approvePrinter(payload));
    ipcMain.handle('mina:printing:propose', (_event, payload) => controller.proposePrint(payload));
    ipcMain.handle('mina:printing:submit', (_event, payload) => controller.submitPrint(payload));
    ipcMain.handle('mina:printing:reconcile', (_event, payload) => controller.reconcilePrint(payload));
  }
}
