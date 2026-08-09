export function createDocumentController({
  intake, parserRegistry = null, evidenceStore = null, classifier = null, memoryService = null,
  formService = null, converter = null, downloadService = null, printService = null, printerRegistry = null,
} = {}) {
  if (!intake?.intake || !intake?.inspect || !intake?.promote) throw new TypeError('document_controller_dependencies_required');

  const documentListProjection = (record) => Object.freeze({
    documentId: record.documentId,
    declaredName: record.declaredName,
    detectedType: record.detectedType,
    size: record.size,
    status: record.status,
    reasons: [...record.reasons],
    observedAt: record.observedAt,
  });

  return Object.freeze({
    intakeDocument: (input) => intake.intake(input),
    getDocument: (documentId) => intake.inspect(documentId),
    async listDocuments() {
      if (!intake.list) throw new Error('document_quarantine_listing_unavailable');
      const records = await intake.list();
      if (!Array.isArray(records)) throw new Error('document_quarantine_listing_invalid');
      return Object.freeze(records.map(documentListProjection));
    },
    promoteDocument: ({ documentId, destination } = {}) => intake.promote(documentId, destination),

    async parseDocument(documentId) {
      if (!parserRegistry) throw new Error('document_parser_not_configured');
      const observation = await parserRegistry.parse(documentId);
      if (evidenceStore) await evidenceStore.store(observation);
      return Object.freeze({
        documentId: observation.documentId,
        mediaType: observation.mediaType,
        pageCount: observation.pageCount,
        confidence: observation.confidence,
        parserId: observation.parserId,
        parserVersion: observation.parserVersion,
        blockCount: observation.blocks.length,
      });
    },

    proposeClassification: (observation, hints) => {
      if (!classifier?.proposeClassification) throw new Error('document_classifier_not_configured');
      return classifier.proposeClassification(observation, hints);
    },
    async proposeClassificationForDocument(documentId, hints) {
      if (!classifier?.proposeClassification) throw new Error('document_classifier_not_configured');
      if (!evidenceStore?.get) throw new Error('document_evidence_not_configured');
      const observation = await evidenceStore.get(documentId);
      if (!observation) throw new Error('document_not_parsed');
      return classifier.proposeClassification(observation, hints);
    },
    confirmClassification: (proposalId, overrides) => {
      if (!classifier?.confirmClassification) throw new Error('document_classifier_not_configured');
      return classifier.confirmClassification(proposalId, overrides);
    },
    indexSelection: (input) => {
      if (!memoryService?.indexSelection) throw new Error('document_memory_not_configured');
      return memoryService.indexSelection(input);
    },
    forgetDocument: (documentId) => {
      if (!memoryService?.forgetDocument) throw new Error('document_memory_not_configured');
      return memoryService.forgetDocument(documentId);
    },

    proposeFill: (input) => {
      if (!formService?.proposeFill) throw new Error('document_form_rendering_unavailable');
      return formService.proposeFill(input);
    },
    renderFormPreview: (proposalId) => {
      if (!formService?.renderPreview) throw new Error('document_form_rendering_unavailable');
      return formService.renderPreview(proposalId);
    },
    async commitFormCopy(proposalId, options) {
      if (!formService?.commitCopy) throw new Error('document_form_rendering_unavailable');
      return formService.commitCopy(proposalId, options);
    },

    convertDocument: (input) => {
      if (!converter?.convert) throw new Error('document_converter_not_configured');
      return converter.convert(input);
    },
    downloadDocument: (proposal) => {
      if (!downloadService?.download) throw new Error('document_download_not_configured');
      return downloadService.download(proposal);
    },

    discoverPrinters: () => {
      if (!printerRegistry?.discover) throw new Error('printer_registry_not_configured');
      return printerRegistry.discover();
    },
    approvePrinter: (printerId) => {
      if (!printerRegistry?.approvePrinter) throw new Error('printer_registry_not_configured');
      return printerRegistry.approvePrinter(printerId);
    },
    proposePrint: (input) => {
      if (!printService?.proposePrint) throw new Error('print_service_not_configured');
      return printService.proposePrint(input);
    },
    submitPrint: (proposal) => {
      if (!printService?.submit) throw new Error('print_service_not_configured');
      return printService.submit(proposal);
    },
    reconcilePrint: (jobId) => {
      if (!printService?.reconcile) throw new Error('print_service_not_configured');
      return printService.reconcile(jobId);
    },
  });
}
