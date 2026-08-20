import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyMailMigrations, createMailRepository } from '../src/mail/mail-repository.mjs';
import { sealRecord } from '../src/memory/record-codec.mjs';

let db;
let directory;
let repository;
const ENCRYPTION_KEY = Buffer.alloc(32, 13);

function digestOf(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'mina-mail-repository-'));
  db = new Database(join(directory, 'mail.sqlite'));
  applyMailMigrations(db);
  repository = createMailRepository({ db, encryptionKey: ENCRYPTION_KEY });
});

afterEach(async () => {
  if (db?.open) db.close();
  await rm(directory, { recursive: true, force: true });
});

describe('mail repository: attachment blob integrity', () => {
  it('rejects a blob whose supplied digest does not match its bytes', async () => {
    await expect(repository.saveAttachmentBlob({
      digest: `sha256:${'a'.repeat(64)}`,
      bytes: Buffer.from('%PDF-1.7 different bytes'),
    })).rejects.toThrow('mail_attachment_blob_digest_mismatch');
  });

  it('rejects a stored blob whose decrypted bytes no longer match its digest', async () => {
    const bytes = Buffer.from('%PDF-1.7 original attachment');
    const digest = digestOf(bytes);
    await repository.saveAttachment({ digest, detectedType: 'pdf', status: 'inspectable', sizeBytes: bytes.length });
    await repository.saveAttachmentBlob({ digest, bytes });

    const wrongBytes = Buffer.from('%PDF-1.7 tampered attachment');
    const wrongCiphertext = sealRecord({
      key: ENCRYPTION_KEY,
      type: 'mail_attachment_blob',
      id: digest,
      value: { bytesBase64: wrongBytes.toString('base64') },
    });
    db.prepare('UPDATE mail_attachment_blobs SET bytes_ciphertext = ? WHERE digest = ?').run(wrongCiphertext, digest);

    await expect(repository.getAttachmentBytes(digest)).rejects.toThrow('mail_attachment_blob_digest_mismatch');
  });
});

describe('mail repository: message attachment links', () => {
  it('returns attachment metadata only when the digest is linked to that message', async () => {
    const bytes = Buffer.from('%PDF-1.7 linked attachment');
    const digest = digestOf(bytes);
    const saved = await repository.saveMessage({
      accountId: 'google-primary',
      provider: 'gmail',
      dedupKey: 'gmail:google-primary:m1',
      subject: 'Devis',
      bodyText: 'Voir pièce jointe',
      attachments: [],
    });
    await repository.saveAttachment({ digest, detectedType: 'pdf', status: 'inspectable', sizeBytes: bytes.length });
    await repository.linkAttachment({ messageId: saved.messageId, digest, declaredFilename: 'devis.pdf' });

    expect(repository.getAttachmentForMessage({ messageId: saved.messageId, digest })).toEqual(expect.objectContaining({
      digest,
      detectedType: 'pdf',
      status: 'inspectable',
      sizeBytes: bytes.length,
      declaredFilename: 'devis.pdf',
    }));
    expect(repository.getAttachmentForMessage({ messageId: 'other-message', digest })).toBeNull();
  });
});
