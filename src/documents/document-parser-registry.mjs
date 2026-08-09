function validateBlocks(blocks) {
  if (!Array.isArray(blocks) || blocks.length === 0) throw new Error('document_parser_output_invalid:no_blocks');
  for (const block of blocks) {
    if (!block?.sourceOffset || typeof block.sourceOffset !== 'object') {
      throw new Error('document_parser_output_invalid:missing_locator');
    }
    if (typeof block.confidence !== 'number' || block.confidence < 0 || block.confidence > 1) {
      throw new Error('document_parser_output_invalid:missing_confidence');
    }
    if (typeof block.text !== 'string') throw new Error('document_parser_output_invalid:missing_text');
  }
}

export function createDocumentParserRegistry({ parsers, quarantineStore, clock } = {}) {
  if (!Array.isArray(parsers) || parsers.length === 0) throw new TypeError('document_parser_registry_parsers_required');
  for (const parser of parsers) {
    if (typeof parser.id !== 'string' || typeof parser.supports !== 'function' || typeof parser.parse !== 'function') {
      throw new TypeError('document_parser_registry_parser_invalid');
    }
  }
  if (!quarantineStore?.getRecord || !quarantineStore?.readBytes) throw new TypeError('document_parser_registry_quarantine_store_required');
  if (!clock || (typeof clock !== 'function' && typeof clock.now !== 'function')) {
    throw new TypeError('document_parser_registry_clock_required');
  }
  const now = () => Number(typeof clock === 'function' ? clock() : clock.now());
  const cache = new Map();

  return Object.freeze({
    async parse(documentId, { signal } = {}) {
      const item = await quarantineStore.getRecord(documentId);
      if (!item) throw new Error('document_not_found');
      if (item.status === 'blocked') throw new Error('document_parse_blocked');

      const parser = parsers.find((candidate) => candidate.supports(item.detectedType));
      if (!parser) throw new Error('document_parser_not_found');

      const bytes = await quarantineStore.readBytes(documentId);
      const result = await parser.parse({ bytes, mediaType: item.detectedType, signal });
      validateBlocks(result.blocks);

      const confidences = result.blocks.map((block) => block.confidence);
      const observation = Object.freeze({
        documentId,
        mediaType: item.detectedType,
        pageCount: result.pageCount ?? null,
        sections: Object.freeze(result.sections ?? []),
        blocks: Object.freeze(result.blocks.map((block) => Object.freeze({ ...block, sourceOffset: Object.freeze({ ...block.sourceOffset }) }))),
        tables: Object.freeze(result.tables ?? []),
        fields: Object.freeze(result.fields ?? []),
        sourceOffsets: Object.freeze(result.blocks.map((block) => block.sourceOffset)),
        confidence: confidences.reduce((sum, value) => sum + value, 0) / confidences.length,
        parserId: parser.id,
        parserVersion: parser.version ?? '0',
        observedAt: new Date(now()).toISOString(),
      });
      cache.set(documentId, observation);
      return observation;
    },

    async cite(documentId, locator) {
      const observation = cache.get(documentId);
      if (!observation) throw new Error('document_not_parsed');
      const match = observation.blocks.find((block) => JSON.stringify(block.sourceOffset) === JSON.stringify(locator));
      if (!match) throw new Error('citation_locator_not_found');
      return Object.freeze({ documentId, locator: Object.freeze({ ...locator }), text: match.text, confidence: match.confidence });
    },
  });
}
