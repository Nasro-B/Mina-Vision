import { createHash } from 'node:crypto';

const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 500;
const MAX_ZIP_TOTAL_BYTES = 100 * 1024 * 1024;
// Anti-bombe (R-02) : ratio déclaré taille/compressé refusé avant toute décompression ; le
// seuil ne s'applique qu'aux entrées significatives (en dessous, les bornes absolues suffisent).
const MAX_ZIP_EXPANSION_RATIO = 100;
const ZIP_EXPANSION_CHECK_MIN_BYTES = 64 * 1024;
const OLE2_SIGNATURE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const ZIP_SIGNATURE = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const PDF_SIGNATURE = Buffer.from('%PDF-');
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff]);
const MACRO_ENTRIES = new Set(['word/vbaProject.bin', 'xl/vbaProject.bin', 'ppt/vbaProject.bin']);
const EXECUTABLE_SIGNATURES = [
  Buffer.from('MZ'),
  Buffer.from([0x7f, 0x45, 0x4c, 0x46]),
  Buffer.from([0xfe, 0xed, 0xfa, 0xce]),
  Buffer.from([0xfe, 0xed, 0xfa, 0xcf]),
  Buffer.from([0xcf, 0xfa, 0xed, 0xfe]),
];
const SHEBANG = Buffer.from('#!');

function startsWith(bytes, signature) {
  return bytes.length >= signature.length && bytes.subarray(0, signature.length).equals(signature);
}

function isExecutable(bytes) {
  return EXECUTABLE_SIGNATURES.some((signature) => startsWith(bytes, signature)) || startsWith(bytes, SHEBANG);
}

function detectSimpleType(bytes) {
  if (startsWith(bytes, PDF_SIGNATURE)) return 'application/pdf';
  if (startsWith(bytes, PNG_SIGNATURE)) return 'image/png';
  if (startsWith(bytes, JPEG_SIGNATURE)) return 'image/jpeg';
  return 'application/octet-stream';
}

function isTraversalEntry(name) {
  return !name || name.startsWith('/') || /^[a-z]:/iu.test(name)
    || name.split('/').some((segment) => segment === '..' || segment === '.');
}

async function inspectZip(bytes) {
  const { default: AdmZip } = await import('adm-zip');
  const archive = new AdmZip(bytes);
  const entries = archive.getEntries();
  if (entries.length > MAX_ZIP_ENTRIES) throw new Error('attachment_zip_entry_count_exceeded');
  let totalUncompressed = 0;
  let macroDetected = false;
  for (const entry of entries) {
    const name = String(entry.entryName ?? '').replace(/\\/gu, '/');
    if (isTraversalEntry(name)) throw new Error('attachment_zip_traversal_forbidden');
    if (entry.header?.flags & 1) throw new Error('attachment_zip_encrypted_forbidden');
    const size = Number(entry.header?.size ?? 0);
    const compressedSize = Number(entry.header?.compressedSize ?? 0);
    if (!Number.isFinite(size) || size < 0 || !Number.isFinite(compressedSize) || compressedSize < 0) {
      throw new Error('attachment_archive_size_invalid');
    }
    if (size > ZIP_EXPANSION_CHECK_MIN_BYTES
      && (compressedSize === 0 || size / compressedSize > MAX_ZIP_EXPANSION_RATIO)) {
      throw new Error('attachment_archive_expansion_limit');
    }
    totalUncompressed += size;
    if (totalUncompressed > MAX_ZIP_TOTAL_BYTES) throw new Error('attachment_zip_bomb_suspected');
    if (MACRO_ENTRIES.has(name)) macroDetected = true;
  }
  return macroDetected;
}

export async function quarantineAttachment({ bytes, declaredFilename, declaredContentType } = {}) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 1) throw new TypeError('attachment_bytes_invalid');
  if (bytes.length > MAX_ATTACHMENT_BYTES) throw new Error('attachment_too_large');

  const digest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  const filename = String(declaredFilename ?? '').slice(0, 500);
  const base = Object.freeze({ digest, declaredFilename: filename, declaredContentType: declaredContentType ?? null });

  if (isExecutable(bytes)) {
    return Object.freeze({ ...base, detectedType: 'application/x-executable', status: 'blocked', reasons: Object.freeze(['executable']) });
  }
  if (startsWith(bytes, OLE2_SIGNATURE)) {
    return Object.freeze({ ...base, detectedType: 'application/x-ole-compound', status: 'quarantined', reasons: Object.freeze(['legacy_office_macro_risk']) });
  }
  if (startsWith(bytes, ZIP_SIGNATURE)) {
    let macroDetected;
    try {
      macroDetected = await inspectZip(bytes);
    } catch (error) {
      return Object.freeze({ ...base, detectedType: 'application/zip', status: 'blocked', reasons: Object.freeze([error.message]) });
    }
    return Object.freeze({
      ...base,
      detectedType: 'application/zip',
      status: macroDetected ? 'quarantined' : 'inspectable',
      reasons: Object.freeze(macroDetected ? ['macro_enabled_office'] : []),
    });
  }
  return Object.freeze({ ...base, detectedType: detectSimpleType(bytes), status: 'inspectable', reasons: Object.freeze([]) });
}
