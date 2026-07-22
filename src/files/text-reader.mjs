import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { extname } from 'node:path';
import { redactSensitiveText } from '../research/network-evidence.mjs';

export const TEXT_EXTENSIONS = Object.freeze(new Set([
  '.txt', '.log', '.md', '.markdown', '.json', '.csv', '.html', '.htm',
  '.yaml', '.yml', '.xml', '.toml', '.ini', '.cfg', '.js', '.mjs', '.cjs',
  '.jsx', '.ts', '.tsx', '.py', '.java', '.kt', '.kts', '.c', '.h', '.cpp',
  '.hpp', '.cs', '.go', '.rs', '.php', '.rb', '.sh', '.ps1', '.sql', '.css',
  '.scss', '.less', '.vue', '.svelte',
]));

function sha256(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function decodeText(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { text: new TextDecoder('utf-16le', { fatal: true }).decode(bytes.subarray(2)), encoding: 'utf-16le' };
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    const source = bytes.subarray(2);
    if (source.length % 2 !== 0) throw new Error('invalid_text_encoding');
    const swapped = Buffer.allocUnsafe(source.length);
    for (let index = 0; index < source.length; index += 2) {
      swapped[index] = source[index + 1];
      swapped[index + 1] = source[index];
    }
    return { text: new TextDecoder('utf-16le', { fatal: true }).decode(swapped), encoding: 'utf-16be' };
  }
  const sample = bytes.subarray(0, Math.min(bytes.length, 8_192));
  if (sample.includes(0)) throw new Error('binary_file_forbidden');
  const offset = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
  return {
    text: new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(offset)),
    encoding: 'utf-8',
  };
}

export function createGroundedChunks(text, { chunkChars = 4_000 } = {}) {
  if (!Number.isSafeInteger(chunkChars) || chunkChars < 1) throw new TypeError('invalid_chunk_size');
  const chunks = [];
  for (let start = 0; start < text.length; start += chunkChars) {
    const end = Math.min(text.length, start + chunkChars);
    const content = text.slice(start, end);
    chunks.push(Object.freeze({
      sourceOffsetStart: start,
      sourceOffsetEnd: end,
      content,
      contentDigest: sha256(content),
    }));
  }
  return Object.freeze(chunks);
}

export function createTextReader({
  fileSystem = { readFile, stat },
  redactor = redactSensitiveText,
  hardMaxBytes = 25 * 1024 * 1024,
  chunkChars = 4_000,
} = {}) {
  async function read({ path, maxBytes = hardMaxBytes, signal } = {}) {
    signal?.throwIfAborted();
    const extension = extname(path ?? '').toLocaleLowerCase('en-US');
    if (!TEXT_EXTENSIONS.has(extension)) throw new Error('unsupported_file_extension');
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
    const decoded = decodeText(bytes);
    const text = redactor(decoded.text);
    return Object.freeze({
      path,
      format: extension.slice(1),
      encoding: decoded.encoding,
      size: bytes.length,
      mtime: after.mtimeMs,
      digest: sha256(bytes),
      text,
      chunks: createGroundedChunks(text, { chunkChars }),
      method: 'bounded_text_reader',
    });
  }

  return Object.freeze({ read });
}
