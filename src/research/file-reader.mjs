import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { extname } from 'node:path';
import { classifyCredentialDocument } from '../security/credential-document.mjs';
import { createPdfTextExtractor } from './pdf-text-extractor.mjs';

const TEXT_FORMATS = new Map([
  ['.txt', 'text'], ['.log', 'text'],
  ['.md', 'markdown'], ['.markdown', 'markdown'],
  ['.json', 'json'], ['.csv', 'csv'],
  ['.html', 'html'], ['.htm', 'html'],
  ['.yaml', 'yaml'], ['.yml', 'yaml'], ['.xml', 'xml'], ['.toml', 'toml'],
  ['.ini', 'config'], ['.cfg', 'config'],
  ['.js', 'code'], ['.mjs', 'code'], ['.cjs', 'code'], ['.jsx', 'code'],
  ['.ts', 'code'], ['.tsx', 'code'], ['.py', 'code'], ['.java', 'code'],
  ['.kt', 'code'], ['.kts', 'code'], ['.c', 'code'], ['.h', 'code'],
  ['.cpp', 'code'], ['.hpp', 'code'], ['.cs', 'code'], ['.go', 'code'],
  ['.rs', 'code'], ['.php', 'code'], ['.rb', 'code'], ['.sh', 'code'],
  ['.ps1', 'code'], ['.sql', 'code'], ['.css', 'code'], ['.scss', 'code'],
  ['.less', 'code'], ['.vue', 'code'], ['.svelte', 'code'],
]);

function htmlToText(html) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, ' ')
    .replace(/<[^>]+>/gu, ' ')
    .replace(/&nbsp;/giu, ' ')
    .replace(/&amp;/giu, '&')
    .replace(/&lt;/giu, '<')
    .replace(/&gt;/giu, '>')
    .replace(/[ \t]+/gu, ' ')
    .replace(/\s*\n\s*/gu, '\n')
    .trim();
}

function assertText(bytes) {
  if (bytes.subarray(0, Math.min(bytes.length, 8_192)).includes(0)) throw new Error('binary_file_forbidden');
}

export function createFileReader({
  policy,
  fileSystem = { readFile, stat },
  pdfExtractor = createPdfTextExtractor(),
  maxFileBytes = 25 * 1024 * 1024,
  maxPdfPages = 2_000,
} = {}) {
  if (!policy?.authorize) throw new TypeError('file_policy_required');

  async function read({ path, operation = 'read', confirmed = false } = {}) {
    const canonical = await policy.authorize({ path, operation, confirmed });
    const before = await fileSystem.stat(canonical);
    if (!before.isFile()) throw new Error('file_not_regular');
    if (before.size > maxFileBytes) throw new Error('file_too_large');
    const extension = extname(canonical).toLocaleLowerCase('en-US');
    const format = extension === '.pdf' ? 'pdf' : TEXT_FORMATS.get(extension);
    if (!format) throw new Error('unsupported_file_extension');
    const bytes = await fileSystem.readFile(canonical);
    const after = await fileSystem.stat(canonical);
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || bytes.length !== before.size) {
      throw new Error('file_changed_during_read');
    }
    // Task 4 (R-03) : détection par CONTENU après lecture bornée, avant tout décodage/retour —
    // un credential renommé en .txt reste interdit.
    if (classifyCredentialDocument({ path: canonical, bytes }).sensitive) {
      throw new Error('sensitive_file_forbidden');
    }

    let text;
    let method;
    let pages;
    if (format === 'pdf') {
      if (typeof pdfExtractor !== 'function') throw new Error('pdf_extractor_unavailable');
      const extracted = await pdfExtractor(bytes, { maxPages: maxPdfPages, maxBytes: maxFileBytes });
      if (typeof extracted?.text !== 'string' || !Number.isInteger(extracted.pages)
        || extracted.pages < 1 || extracted.pages > maxPdfPages) {
        throw new Error('invalid_pdf_extraction');
      }
      ({ text, pages } = extracted);
      method = 'pdf_text_adapter';
    } else {
      assertText(bytes);
      const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      if (format === 'json') JSON.parse(decoded);
      text = format === 'html' ? htmlToText(decoded) : decoded;
      method = format === 'html' ? 'html_text' : 'utf8_text';
    }
    const lineEnd = Math.max(1, text.split(/\r?\n/u).length);
    return Object.freeze({
      path: canonical,
      digest: createHash('sha256').update(bytes).digest('hex'),
      mtime: after.mtimeMs,
      size: bytes.length,
      format,
      text,
      method,
      lineStart: 1,
      lineEnd,
      ...(pages ? { pages } : {}),
    });
  }

  return Object.freeze({ read });
}
