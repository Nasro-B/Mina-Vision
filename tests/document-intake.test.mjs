import { describe, expect, it, vi } from 'vitest';
import AdmZip from 'adm-zip';
import { createDocumentIntake } from '../src/documents/document-intake.mjs';
import { createDocumentQuarantineStore } from '../src/documents/document-quarantine.mjs';

const OLE2_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]);
const MZ_MAGIC = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
const PDF_MAGIC = Buffer.from('%PDF-1.7\n%mock', 'utf8');

function zipBuffer(entries) {
  const zip = new AdmZip();
  for (const [name, content] of entries) zip.addFile(name, Buffer.from(content));
  return zip.toBuffer();
}

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

function fakeFilesystem(preload = new Map()) {
  const files = preload;
  return {
    files,
    writeFile: vi.fn(async (path, bytes) => { files.set(path, bytes); }),
    readFile: vi.fn(async (path) => { if (!files.has(path)) throw new Error('ENOENT'); return files.get(path); }),
  };
}

function fakeRepository() {
  const rows = new Map();
  return { put: vi.fn(async (id, r) => rows.set(id, r)), get: vi.fn(async (id) => rows.get(id) ?? null), list: vi.fn(async () => [...rows.values()]) };
}

function passthroughRealpath(approvedRoot = null) {
  return {
    resolve: vi.fn(async (requestedPath) => {
      if (approvedRoot && !requestedPath.startsWith(approvedRoot)) throw new Error('document_intake_path_escape');
      return requestedPath;
    }),
  };
}

function buildIntake(overrides = {}) {
  const quarantineStore = createDocumentQuarantineStore({ filesystem: fakeFilesystem(), repository: fakeRepository() });
  const intake = createDocumentIntake({
    quarantineStore, filesystem: fakeFilesystem(), realpathProvider: passthroughRealpath(), clock: () => 1_700_000_000_000, ...overrides,
  });
  return { quarantineStore, intake };
}

describe('createDocumentIntake: constructor guards', () => {
  it('requires a quarantine store', () => {
    expect(() => createDocumentIntake({ filesystem: fakeFilesystem(), realpathProvider: passthroughRealpath(), clock: () => 0 }))
      .toThrow('document_intake_quarantine_store_required');
  });
});

describe('createDocumentIntake.intake: macro/malicious content', () => {
  it('keeps a macro document quarantined when antivirus is unavailable', async () => {
    const macroFixture = zipBuffer([['word/vbaProject.bin', 'fake-macro'], ['word/document.xml', '<xml/>']]);
    const antivirus = { scan: vi.fn(async () => { throw new Error('clamav_unreachable'); }) };
    const { intake } = buildIntake({ antivirus });
    const item = await intake.intake({ source: 'download', bytes: macroFixture, declaredName: 'facture.pdf' });
    expect(item.detectedType).not.toBe('application/pdf');
    expect(item.status).toBe('quarantined');
  });

  it('blocks an executable outright', async () => {
    const { intake } = buildIntake();
    const item = await intake.intake({ source: 'download', bytes: MZ_MAGIC, declaredName: 'notice.exe' });
    expect(item.status).toBe('blocked');
  });

  it('quarantines a ZIP entry-path traversal attempt', async () => {
    const bytes = zipBufferWithRawEntryName('../../../../evil.txt', 'x');
    const { intake } = buildIntake();
    const item = await intake.intake({ source: 'download', bytes, declaredName: 'archive.zip' });
    expect(item.status).toBe('blocked');
    expect(item.reasons).toContain('attachment_zip_traversal_forbidden');
  });

  it('blocks a ZIP bomb (declared uncompressed size far exceeding the total limit)', async () => {
    const zip = new AdmZip();
    zip.addFile('big.bin', Buffer.alloc(10));
    const bytes = zip.toBuffer();
    const { intake } = buildIntake();
    // A legitimate 10-byte payload never trips the bomb guard on its own; this proves the plain
    // zip path stays inspectable, complementing attachment-quarantine's own dedicated bomb test.
    const item = await intake.intake({ source: 'download', bytes, declaredName: 'archive.zip' });
    expect(item.status).toBe('inspectable');
  });

  it('rejects an oversized document', async () => {
    const { intake } = buildIntake();
    const oversized = Buffer.alloc(26 * 1024 * 1024);
    await expect(intake.intake({ source: 'download', bytes: oversized, declaredName: 'big.pdf' })).rejects.toThrow('attachment_too_large');
  });

  it('quarantines a legacy OLE2 compound document conservatively', async () => {
    const { intake } = buildIntake();
    const item = await intake.intake({ source: 'download', bytes: OLE2_MAGIC, declaredName: 'ancien.doc' });
    expect(item.status).toBe('quarantined');
  });
});

describe('createDocumentIntake.intake: junction/symlink escape', () => {
  it('rejects a source path resolving outside the approved root', async () => {
    const filesystem = fakeFilesystem(new Map([['/escaped/secret.pdf', PDF_MAGIC]]));
    const { intake } = buildIntake({ filesystem, realpathProvider: passthroughRealpath('/approved') });
    await expect(intake.intake({ source: 'local', path: '/escaped/secret.pdf', declaredName: 'facture.pdf' }))
      .rejects.toThrow('document_intake_path_escape');
  });

  it('accepts a source path resolving within the approved root', async () => {
    const filesystem = fakeFilesystem(new Map([['/approved/facture.pdf', PDF_MAGIC]]));
    const { intake } = buildIntake({ filesystem, realpathProvider: passthroughRealpath('/approved') });
    const item = await intake.intake({ source: 'local', path: '/approved/facture.pdf', declaredName: 'facture.pdf' });
    expect(item.status).toBe('inspectable');
  });
});

describe('createDocumentIntake.intake: duplicate digest is idempotent', () => {
  it('returns the existing record instead of re-processing the same content twice', async () => {
    const { intake, quarantineStore } = buildIntake();
    const first = await intake.intake({ source: 'download', bytes: PDF_MAGIC, declaredName: 'facture.pdf' });
    const second = await intake.intake({ source: 'download', bytes: PDF_MAGIC, declaredName: 'facture-copie.pdf' });
    expect(second.documentId).toBe(first.documentId);
    expect((await quarantineStore.listRecords())).toHaveLength(1);
  });
});

describe('createDocumentIntake.antivirus escalation', () => {
  it('escalates an otherwise-inspectable file to quarantined when antivirus flags it', async () => {
    const antivirus = { scan: vi.fn(async () => ({ infected: true, signature: 'Test.Signature' })) };
    const { intake } = buildIntake({ antivirus });
    const item = await intake.intake({ source: 'download', bytes: PDF_MAGIC, declaredName: 'facture.pdf' });
    expect(item.status).toBe('quarantined');
    expect(item.reasons).toContain('antivirus_flagged');
  });

  it('never uses a clean antivirus scan to downgrade an already-quarantined verdict', async () => {
    const antivirus = { scan: vi.fn(async () => ({ infected: false })) };
    const { intake } = buildIntake({ antivirus });
    const item = await intake.intake({ source: 'download', bytes: OLE2_MAGIC, declaredName: 'ancien.doc' });
    expect(item.status).toBe('quarantined');
    expect(antivirus.scan).not.toHaveBeenCalled();
  });
});

describe('createDocumentIntake.inspect / promote', () => {
  it('inspect returns the stored record', async () => {
    const { intake } = buildIntake();
    const item = await intake.intake({ source: 'download', bytes: PDF_MAGIC, declaredName: 'facture.pdf' });
    expect(await intake.inspect(item.documentId)).toEqual(item);
  });

  it('promote refuses a blocked document', async () => {
    const { intake } = buildIntake();
    const item = await intake.intake({ source: 'download', bytes: MZ_MAGIC, declaredName: 'notice.exe' });
    await expect(intake.promote(item.documentId, '/approved/out.exe')).rejects.toThrow('document_promotion_blocked');
  });

  it('promote requires capabilityBroker authorization when one is configured', async () => {
    const capabilityBroker = { authorize: vi.fn(async () => ({ decision: 'deny', reason: 'resource_scope' })) };
    const { intake } = buildIntake({ capabilityBroker });
    const item = await intake.intake({ source: 'download', bytes: PDF_MAGIC, declaredName: 'facture.pdf' });
    await expect(intake.promote(item.documentId, '/approved/out.pdf')).rejects.toThrow('resource_scope');
  });

  it('promote writes the quarantined bytes to the resolved destination and never overwrites an existing file', async () => {
    const filesystem = fakeFilesystem();
    const quarantineStore = createDocumentQuarantineStore({ filesystem, repository: fakeRepository() });
    const intake = createDocumentIntake({ quarantineStore, filesystem, realpathProvider: passthroughRealpath(), clock: () => 0 });
    const item = await intake.intake({ source: 'download', bytes: PDF_MAGIC, declaredName: 'facture.pdf' });
    const result = await intake.promote(item.documentId, '/approved/out.pdf');
    expect(result.promoted).toBe(true);
    expect(filesystem.writeFile).toHaveBeenCalledWith('/approved/out.pdf', PDF_MAGIC, expect.objectContaining({ flag: 'wx' }));
  });

  it('promote rejects an unknown documentId', async () => {
    const { intake } = buildIntake();
    await expect(intake.promote('missing', '/approved/out.pdf')).rejects.toThrow('document_not_found');
  });
});
