import { describe, expect, it, vi } from 'vitest';
import { createDocumentParserRegistry } from '../src/documents/document-parser-registry.mjs';

function fakeQuarantineStore(records = new Map(), bytesByDocId = new Map()) {
  return {
    getRecord: vi.fn(async (id) => records.get(id) ?? null),
    readBytes: vi.fn(async (id) => bytesByDocId.get(id) ?? Buffer.from('bytes')),
  };
}

function pdfParser({ blocks } = {}) {
  return {
    id: 'pdf-text-parser', version: '1',
    supports: (mediaType) => mediaType === 'application/pdf',
    parse: vi.fn(async () => ({
      pageCount: 1,
      blocks: blocks ?? [{ page: 1, text: 'Bonjour', sourceOffset: { page: 1, start: 0, end: 7 }, confidence: 0.95 }],
    })),
  };
}

const pdfItem = Object.freeze({ documentId: 'd1', detectedType: 'application/pdf', status: 'inspectable' });

describe('createDocumentParserRegistry: constructor guards', () => {
  it('requires at least one parser', () => {
    expect(() => createDocumentParserRegistry({ parsers: [], quarantineStore: fakeQuarantineStore(), clock: () => 0 }))
      .toThrow('document_parser_registry_parsers_required');
  });

  it('rejects a parser missing supports/parse', () => {
    expect(() => createDocumentParserRegistry({ parsers: [{ id: 'x' }], quarantineStore: fakeQuarantineStore(), clock: () => 0 }))
      .toThrow('document_parser_registry_parser_invalid');
  });
});

describe('createDocumentParserRegistry.parse: exact shape from the plan', () => {
  it('produces a block with page/text/sourceOffset/confidence', async () => {
    const records = new Map([['d1', pdfItem]]);
    const registry = createDocumentParserRegistry({ parsers: [pdfParser()], quarantineStore: fakeQuarantineStore(records), clock: () => 0 });
    const observation = await registry.parse('d1');
    expect(observation.blocks[0]).toMatchObject({ page: 1, text: expect.any(String), sourceOffset: expect.any(Object), confidence: expect.any(Number) });
  });

  it('produces the full documented observation shape', async () => {
    const records = new Map([['d1', pdfItem]]);
    const registry = createDocumentParserRegistry({ parsers: [pdfParser()], quarantineStore: fakeQuarantineStore(records), clock: () => 1_700_000_000_000 });
    const observation = await registry.parse('d1');
    expect(observation).toMatchObject({
      documentId: 'd1', mediaType: 'application/pdf', pageCount: 1, parserId: 'pdf-text-parser', parserVersion: '1',
    });
    expect(Array.isArray(observation.sections)).toBe(true);
    expect(Array.isArray(observation.tables)).toBe(true);
    expect(Array.isArray(observation.fields)).toBe(true);
    expect(observation.sourceOffsets).toEqual([{ page: 1, start: 0, end: 7 }]);
  });

  it('rejects parser output with a block missing a locator (sourceOffset)', async () => {
    const records = new Map([['d1', pdfItem]]);
    const badParser = pdfParser({ blocks: [{ page: 1, text: 'x', confidence: 0.9 }] });
    const registry = createDocumentParserRegistry({ parsers: [badParser], quarantineStore: fakeQuarantineStore(records), clock: () => 0 });
    await expect(registry.parse('d1')).rejects.toThrow('document_parser_output_invalid:missing_locator');
  });

  it('rejects parser output with a block missing confidence', async () => {
    const records = new Map([['d1', pdfItem]]);
    const badParser = pdfParser({ blocks: [{ page: 1, text: 'x', sourceOffset: { page: 1 } }] });
    const registry = createDocumentParserRegistry({ parsers: [badParser], quarantineStore: fakeQuarantineStore(records), clock: () => 0 });
    await expect(registry.parse('d1')).rejects.toThrow('document_parser_output_invalid:missing_confidence');
  });

  it('rejects parsing a blocked document', async () => {
    const records = new Map([['d1', { ...pdfItem, status: 'blocked' }]]);
    const registry = createDocumentParserRegistry({ parsers: [pdfParser()], quarantineStore: fakeQuarantineStore(records), clock: () => 0 });
    await expect(registry.parse('d1')).rejects.toThrow('document_parse_blocked');
  });

  it('allows parsing a quarantined (not blocked) document', async () => {
    const records = new Map([['d1', { ...pdfItem, status: 'quarantined' }]]);
    const registry = createDocumentParserRegistry({ parsers: [pdfParser()], quarantineStore: fakeQuarantineStore(records), clock: () => 0 });
    await expect(registry.parse('d1')).resolves.toMatchObject({ documentId: 'd1' });
  });

  it('rejects an unknown document', async () => {
    const registry = createDocumentParserRegistry({ parsers: [pdfParser()], quarantineStore: fakeQuarantineStore(), clock: () => 0 });
    await expect(registry.parse('missing')).rejects.toThrow('document_not_found');
  });

  it('rejects when no registered parser supports the detected media type', async () => {
    const records = new Map([['d1', { ...pdfItem, detectedType: 'application/zip' }]]);
    const registry = createDocumentParserRegistry({ parsers: [pdfParser()], quarantineStore: fakeQuarantineStore(records), clock: () => 0 });
    await expect(registry.parse('d1')).rejects.toThrow('document_parser_not_found');
  });
});

describe('createDocumentParserRegistry.cite', () => {
  it('returns a verified citation for a locator matching a parsed block', async () => {
    const records = new Map([['d1', pdfItem]]);
    const registry = createDocumentParserRegistry({ parsers: [pdfParser()], quarantineStore: fakeQuarantineStore(records), clock: () => 0 });
    await registry.parse('d1');
    const citation = await registry.cite('d1', { page: 1, start: 0, end: 7 });
    expect(citation).toMatchObject({ documentId: 'd1', text: 'Bonjour' });
  });

  it('rejects a locator that does not match any parsed block', async () => {
    const records = new Map([['d1', pdfItem]]);
    const registry = createDocumentParserRegistry({ parsers: [pdfParser()], quarantineStore: fakeQuarantineStore(records), clock: () => 0 });
    await registry.parse('d1');
    await expect(registry.cite('d1', { page: 99, start: 0, end: 1 })).rejects.toThrow('citation_locator_not_found');
  });

  it('rejects citing a document that was never parsed', async () => {
    const registry = createDocumentParserRegistry({ parsers: [pdfParser()], quarantineStore: fakeQuarantineStore(), clock: () => 0 });
    await expect(registry.cite('d1', { page: 1 })).rejects.toThrow('document_not_parsed');
  });
});
