import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyMailMigrations, createMailRepository } from '../src/mail/mail-repository.mjs';
import { openRecord } from '../src/memory/record-codec.mjs';
import { createMailSyncService } from '../src/mail/mail-sync-service.mjs';

let db;
let directory;
let repository;
const ENCRYPTION_KEY = Buffer.alloc(32, 11);

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'mina-mail-sync-'));
  db = new Database(join(directory, 'mail.sqlite'));
  applyMailMigrations(db);
  repository = createMailRepository({ db, encryptionKey: ENCRYPTION_KEY });
});

afterEach(async () => {
  if (db?.open) db.close();
  await rm(directory, { recursive: true, force: true });
});

function fakeAdapter({ pages } = {}) {
  let call = 0;
  return {
    id: 'personal-imap',
    sync: vi.fn(async ({ cursor, persist }) => {
      const page = pages[Math.min(call, pages.length - 1)];
      call += 1;
      for (const message of page.messages) await persist(message);
      return page.result;
    }),
  };
}

const MESSAGE_A = Object.freeze({
  provider: 'imap-smtp', providerMessageId: '<a@example.test>', dedupKey: 'imap-smtp:personal-imap:INBOX:77:1',
  subject: 'Bonjour', bodyText: 'Contenu A', trust: 'external_untrusted', attachments: [],
});

describe('mail sync service: cursor restart and duplicate events', () => {
  it('persists a first page then resumes from the saved cursor on the next sync, without reprocessing', async () => {
    const adapter = fakeAdapter({
      pages: [
        { messages: [MESSAGE_A], result: { uidValidity: '77', lastUid: 1, imported: 1 } },
        { messages: [], result: { uidValidity: '77', lastUid: 1, imported: 0 } },
      ],
    });
    const service = createMailSyncService({ repository, adapters: { 'personal-imap': adapter } });

    await service.syncAccount('personal-imap');
    await service.syncAccount('personal-imap');

    expect(adapter.sync).toHaveBeenNthCalledWith(1, expect.objectContaining({ cursor: null }));
    expect(adapter.sync).toHaveBeenNthCalledWith(2, expect.objectContaining({ cursor: { uidValidity: '77', lastUid: 1, imported: 1 } }));
  });

  it('does not duplicate a message replayed twice by the provider, by dedup key', async () => {
    const adapter = fakeAdapter({ pages: [{ messages: [MESSAGE_A, MESSAGE_A], result: { uidValidity: '77', lastUid: 1, imported: 2 } }] });
    const service = createMailSyncService({ repository, adapters: { 'personal-imap': adapter } });

    const result = await service.syncAccount('personal-imap');
    expect(result.newMessages).toBe(1);
    expect(result.duplicateMessages).toBe(1);
  });
});

describe('mail sync service: account pause and resume', () => {
  it('skips a paused account without calling the adapter', async () => {
    const adapter = fakeAdapter({ pages: [{ messages: [MESSAGE_A], result: { uidValidity: '77', lastUid: 1, imported: 1 } }] });
    const service = createMailSyncService({ repository, adapters: { 'personal-imap': adapter } });

    await service.pause('personal-imap');
    const result = await service.syncAccount('personal-imap');
    expect(result).toEqual({ paused: true, newMessages: 0, duplicateMessages: 0 });
    expect(adapter.sync).not.toHaveBeenCalled();
  });

  it('resumes a paused account and syncs normally again', async () => {
    const adapter = fakeAdapter({ pages: [{ messages: [MESSAGE_A], result: { uidValidity: '77', lastUid: 1, imported: 1 } }] });
    const service = createMailSyncService({ repository, adapters: { 'personal-imap': adapter } });

    await service.pause('personal-imap');
    await service.resume('personal-imap');
    const result = await service.syncAccount('personal-imap');
    expect(adapter.sync).toHaveBeenCalledTimes(1);
    expect(result.newMessages).toBe(1);
  });
});

describe('mail sync service: attachment quarantine wiring', () => {
  it('quarantines a message attachment and links it to the message, deduping by digest', async () => {
    const macroBuffer = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
    const messageWithAttachment = Object.freeze({
      ...MESSAGE_A,
      dedupKey: 'imap-smtp:personal-imap:INBOX:77:2',
      attachments: Object.freeze([{ filename: 'facture.exe', bytes: macroBuffer }]),
    });
    const adapter = fakeAdapter({ pages: [{ messages: [messageWithAttachment], result: { uidValidity: '77', lastUid: 2, imported: 1 } }] });
    const service = createMailSyncService({ repository, adapters: { 'personal-imap': adapter } });

    await service.syncAccount('personal-imap');
    const stored = repository.getMessageByDedupKey(messageWithAttachment.dedupKey);
    expect(stored.attachments).toEqual([expect.objectContaining({ declaredFilename: 'facture.exe', status: 'blocked' })]);
  });

  it('does not retain attachment bytes in the encrypted message body after quarantine', async () => {
    const attachmentBytes = Buffer.from('%PDF-1.7 attachment content that must not remain in the message body');
    const messageWithAttachment = Object.freeze({
      ...MESSAGE_A,
      dedupKey: 'imap-smtp:personal-imap:INBOX:77:privacy',
      attachments: Object.freeze([{ filename: 'devis.pdf', bytes: attachmentBytes }]),
    });
    const adapter = fakeAdapter({ pages: [{ messages: [messageWithAttachment], result: { uidValidity: '77', lastUid: 5, imported: 1 } }] });
    const service = createMailSyncService({ repository, adapters: { 'personal-imap': adapter } });

    await service.syncAccount('personal-imap');

    const row = db.prepare('SELECT message_id, body_ciphertext FROM mail_messages WHERE dedup_key = ?')
      .get(messageWithAttachment.dedupKey);
    const body = openRecord({ key: ENCRYPTION_KEY, type: 'mail_message_body', id: row.message_id, ciphertext: row.body_ciphertext });
    expect(body.attachments).toEqual([]);
    expect(repository.getMessageByDedupKey(messageWithAttachment.dedupKey).attachments)
      .toEqual([expect.objectContaining({ declaredFilename: 'devis.pdf', status: 'inspectable' })]);
  });

  it('deduplicates an identical attachment digest shared by two different messages, storing bytes once', async () => {
    const sameBytes = Buffer.from('%PDF-1.7 shared attachment content');
    const messageOne = Object.freeze({ ...MESSAGE_A, dedupKey: 'imap-smtp:personal-imap:INBOX:77:3', attachments: [{ filename: 'devis.pdf', bytes: sameBytes }] });
    const messageTwo = Object.freeze({ ...MESSAGE_A, dedupKey: 'imap-smtp:personal-imap:INBOX:77:4', attachments: [{ filename: 'devis-copie.pdf', bytes: sameBytes }] });
    const adapter = fakeAdapter({ pages: [{ messages: [messageOne, messageTwo], result: { uidValidity: '77', lastUid: 4, imported: 2 } }] });
    const service = createMailSyncService({ repository, adapters: { 'personal-imap': adapter } });

    await service.syncAccount('personal-imap');

    const digestOne = repository.getMessageByDedupKey(messageOne.dedupKey).attachments[0].digest;
    const digestTwo = repository.getMessageByDedupKey(messageTwo.dedupKey).attachments[0].digest;
    expect(digestOne).toBe(digestTwo);
    expect(db.prepare('SELECT COUNT(*) AS n FROM mail_attachments WHERE digest = ?').get(digestOne).n).toBe(1);
    expect(db.prepare('SELECT COUNT(*) AS n FROM mail_message_attachments WHERE digest = ?').get(digestOne).n).toBe(2);
  });
});
