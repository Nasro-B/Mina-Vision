import { extname } from 'node:path';
import { createDocumentReader, DOCUMENT_EXTENSIONS } from './document-reader.mjs';
import { createTextReader, TEXT_EXTENSIONS } from './text-reader.mjs';

export function createFileReaderRegistry({
  policy,
  textReader = createTextReader(),
  documentReader = createDocumentReader(),
} = {}) {
  if (!policy?.authorize || !textReader?.read || !documentReader?.read) {
    throw new TypeError('file_reader_dependencies_required');
  }

  async function read(request = {}) {
    request.signal?.throwIfAborted();
    const path = await policy.authorize(request);
    request.signal?.throwIfAborted();
    const extension = extname(path).toLocaleLowerCase('en-US');
    const reader = TEXT_EXTENSIONS.has(extension)
      ? textReader
      : DOCUMENT_EXTENSIONS.has(extension) ? documentReader : null;
    if (!reader) throw new Error('unsupported_file_extension');
    return reader.read({ path, maxBytes: request.maxBytes, signal: request.signal });
  }

  return Object.freeze({ read });
}
