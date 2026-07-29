export function createDocumentController({
  intake, parserRegistry = null, evidenceStore = null, classifier = null, memoryService = null,
  formService = null, converter = null, downloadService = null, printService = null, printerRegistry = null,
} = {}) {
  if (!intake?.intake || !intake?.inspect || !intake?.promote) throw new TypeError('document_controller_dependencies_required');

  return Object.freeze({
    intakeDocument: (input) => intake.intake(input),
    getDocument: (documentId) => intake.inspect(documentId),
    promoteDocument: ({ documentId, destination } = {}) => intake.promote(documentId, destination),

    async parseDocument(documentId) {
      if (!parserRegistry) throw new Error('document_parser_not_configured');
      const observation = await parserRegistry.parse(documentId);
      if (evidenceStore) await evidenceStore.store(observation);
      return observation;
    },

    proposeClassification: (observation, hints) => classifier?.proposeClassification(observation, hints),
    confirmClassification: (proposalId, overrides) => classifier?.confirmClassification(proposalId, overrides),
    indexSelection: (input) => memoryService?.indexSelection(input),
    forgetDocument: (documentId) => memoryService?.forgetDocument(documentId),

    proposeFill: (input) => formService?.proposeFill(input),
    renderFormPreview: (proposalId) => formService?.renderPreview(proposalId),
    async commitFormCopy(proposalId, options) {
      if (!formService?.commitCopy) throw new Error('document_form_rendering_unavailable');
      return formService.commitCopy(proposalId, options);
    },

    convertDocument: (input) => converter?.convert(input),
    downloadDocument: (proposal) => downloadService?.download(proposal),

    discoverPrinters: () => printerRegistry?.discover(),
    approvePrinter: (printerId) => printerRegistry?.approvePrinter(printerId),
    proposePrint: (input) => printService?.proposePrint(input),
    submitPrint: (proposal) => printService?.submit(proposal),
    reconcilePrint: (jobId) => printService?.reconcile(jobId),
  });
}
