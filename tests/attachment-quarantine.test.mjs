import { describe, expect, it } from 'vitest';
import AdmZip from 'adm-zip';
import { quarantineAttachment } from '../src/mail/attachment-quarantine.mjs';

const PDF_MAGIC = Buffer.from('%PDF-1.7\n%mock', 'utf8');
const OLE2_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]);
const MZ_MAGIC = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
const ELF_MAGIC = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00]);

function zipBuffer(entries) {
  const zip = new AdmZip();
  for (const [name, content] of entries) zip.addFile(name, Buffer.from(content));
  return zip.toBuffer();
}

// adm-zip's addFile() sanitizes traversal segments out of the entry name when authoring an
// archive, since it is meant for legitimate creation, not attack simulation. To genuinely
// exercise the traversal guard we craft the archive with a same-length placeholder name and
// then patch the raw entry-name bytes in place (both the local header and central directory
// copies), which changes only the name, not any length-prefixed structure around it.
function zipBufferWithRawEntryName(rawName, content) {
  const placeholder = 'x'.repeat(rawName.length);
  const buffer = zipBuffer([[placeholder, content]]);
  const needle = Buffer.from(placeholder, 'utf8');
  const replacement = Buffer.from(rawName, 'utf8');
  let occurrences = 0;
  let index = buffer.indexOf(needle);
  while (index !== -1) {
    replacement.copy(buffer, index);
    occurrences += 1;
    index = buffer.indexOf(needle, index + needle.length);
  }
  if (occurrences < 2) throw new Error(`test_fixture_patch_failed:${occurrences}`);
  return buffer;
}

describe('attachment quarantine: size limits', () => {
  it('rejects an attachment larger than the absolute size limit', async () => {
    await expect(quarantineAttachment({ bytes: Buffer.alloc(26 * 1024 * 1024, 1), declaredFilename: 'gros.pdf' }))
      .rejects.toThrow('attachment_too_large');
  });

  it('rejects empty bytes rather than treating them as a valid attachment', async () => {
    await expect(quarantineAttachment({ bytes: Buffer.alloc(0), declaredFilename: 'vide.txt' }))
      .rejects.toThrow('attachment_bytes_invalid');
  });
});

describe('attachment quarantine: executable detection', () => {
  it('blocks a Windows PE executable disguised with a document filename', async () => {
    const result = await quarantineAttachment({ bytes: MZ_MAGIC, declaredFilename: 'facture.pdf' });
    expect(result.status).toBe('blocked');
    expect(result.reasons).toContain('executable');
    expect(result.detectedType).not.toBe('application/pdf');
  });

  it('blocks an ELF executable', async () => {
    const result = await quarantineAttachment({ bytes: ELF_MAGIC, declaredFilename: 'script.sh' });
    expect(result.status).toBe('blocked');
    expect(result.reasons).toContain('executable');
  });

  it('blocks a shebang script', async () => {
    const result = await quarantineAttachment({ bytes: Buffer.from('#!/bin/bash\nrm -rf /'), declaredFilename: 'notes.txt' });
    expect(result.status).toBe('blocked');
    expect(result.reasons).toContain('executable');
  });
});

describe('attachment quarantine: macro detection', () => {
  it('quarantines an OOXML document containing a VBA macro project', async () => {
    const bytes = zipBuffer([['word/vbaProject.bin', 'fake-macro-bytes'], ['word/document.xml', '<xml/>']]);
    const result = await quarantineAttachment({ bytes, declaredFilename: 'devis.docm' });
    expect(result.status).toBe('quarantined');
    expect(result.reasons).toContain('macro_enabled_office');
  });

  it('leaves a macro-free OOXML document inspectable', async () => {
    const bytes = zipBuffer([['word/document.xml', '<xml/>'], ['[Content_Types].xml', '<t/>']]);
    const result = await quarantineAttachment({ bytes, declaredFilename: 'devis.docx' });
    expect(result.status).toBe('inspectable');
  });

  it('conservatively quarantines any legacy OLE2 compound file as macro risk', async () => {
    const result = await quarantineAttachment({ bytes: OLE2_MAGIC, declaredFilename: 'ancien.doc' });
    expect(result.status).toBe('quarantined');
    expect(result.reasons).toContain('legacy_office_macro_risk');
  });
});

describe('attachment quarantine: ZIP traversal and bomb protection', () => {
  it('blocks a ZIP entry that attempts path traversal outside the extraction root', async () => {
    const bytes = zipBufferWithRawEntryName('../../../../evil.txt', 'x');
    const result = await quarantineAttachment({ bytes, declaredFilename: 'archive.zip' });
    expect(result.status).toBe('blocked');
    expect(result.reasons[0]).toContain('traversal');
  });

  it('blocks a ZIP declaring more entries than the bounded limit', async () => {
    const entries = Array.from({ length: 501 }, (_, index) => [`file-${index}.txt`, 'x']);
    const bytes = zipBuffer(entries);
    const result = await quarantineAttachment({ bytes, declaredFilename: 'bomb.zip' });
    expect(result.status).toBe('blocked');
    expect(result.reasons[0]).toContain('entry_count');
  });
});

describe('attachment quarantine: inert content passes through inspectable', () => {
  it('accepts a plain PDF as inspectable, never executed', async () => {
    const result = await quarantineAttachment({ bytes: PDF_MAGIC, declaredFilename: 'facture.pdf' });
    expect(result.status).toBe('inspectable');
    expect(result.detectedType).toBe('application/pdf');
  });

  it('always returns a stable sha256 digest usable for deduplication', async () => {
    const first = await quarantineAttachment({ bytes: PDF_MAGIC, declaredFilename: 'a.pdf' });
    const second = await quarantineAttachment({ bytes: PDF_MAGIC, declaredFilename: 'b.pdf' });
    expect(first.digest).toBe(second.digest);
    expect(first.digest).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });
});
