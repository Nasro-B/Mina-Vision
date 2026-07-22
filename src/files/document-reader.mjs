import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { extname } from 'node:path';
import { createPdfTextExtractor } from '../research/pdf-text-extractor.mjs';
import { redactSensitiveText } from '../research/network-evidence.mjs';
import { createGroundedChunks } from './text-reader.mjs';

export const DOCUMENT_EXTENSIONS = Object.freeze(new Set([
  '.pdf', '.docx', '.xlsx', '.pptx', '.odt', '.ods', '.odp',
]));

async function defaultLoadOfficeParser() {
  return import('officeparser');
}

function sha256(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

export function createDocumentReader({
  fileSystem = { readFile, stat },
  pdfExtractor = createPdfTextExtractor(),
  loadOfficeParser = defaultLoadOfficeParser,
  redactor = redactSensitiveText,
  hardMaxBytes = 25 * 1024 * 1024,
  maxPdfPages = 2_000,
  chunkChars = 4_000,
} = {}) {
  async function read({ path, maxBytes = hardMaxBytes, signal } = {}) {
    signal?.throwIfAborted();
    const extension = extname(path ?? '').toLocaleLowerCase('en-US');
    if (!DOCUMENT_EXTENSIONS.has(extension)) throw new Error('unsupported_file_extension');
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new TypeError('invalid_file_size_limit');
    const limit = Math.min(maxBytes, hardMaxBytes);
    const before = await fileSystem.stat(path);
    if (!before.isFile()) throw new Error('file_not_regular');
    if (before.size > limit) throw new Error('file_too_large');
    const bytes = await fileSystem.readFile(path, { signal });
    signal?.throwIfAborted();
    const after = await fileSystem.stat(path);
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || bytes.length !== before.size) {
      throw new Error('file_changed_during_read');
    }

    let extracted;
    let pages;
    let method;
    if (extension === '.pdf') {
      const result = await pdfExtractor(bytes, { maxPages: maxPdfPages, maxBytes: limit });
      extracted = result?.text;
      pages = result?.pages;
      method = 'pdf_text_adapter';
    } else {
      const module = await loadOfficeParser();
      const parseOffice = module?.OfficeParser?.parseOffice
        ?? module?.parseOffice
        ?? module?.default?.OfficeParser?.parseOffice
        ?? module?.default?.parseOffice;
      if (typeof parseOffice !== 'function') throw new Error('office_parser_unavailable');
      const ast = await parseOffice(bytes, {
        fileType: extension.slice(1),
        abortSignal: signal,
        ocr: false,
        extractAttachments: false,
        ignoreInternalLinks: true,
        includeRawContent: false,
        serializeRawContent: false,
        verbose: false,
      });
      if (typeof ast?.to !== 'function') throw new Error('invalid_document_ast');
      const converted = await ast.to('text');
      extracted = converted?.value;
      method = 'office_text_adapter';
    }
    signal?.throwIfAborted();
    if (typeof extracted !== 'string') throw new Error('invalid_document_extraction');
    const text = redactor(extracted);
    return Object.freeze({
      path,
      format: extension.slice(1),
      size: bytes.length,
      mtime: after.mtimeMs,
      digest: sha256(bytes),
      text,
      chunks: createGroundedChunks(text, { chunkChars }),
      method,
      ...(Number.isInteger(pages) ? { pages } : {}),
    });
  }

  return Object.freeze({ read });
}
