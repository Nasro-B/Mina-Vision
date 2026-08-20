import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { canonicalJson, openRecord, sealRecord } from '../memory/record-codec.mjs';

const MAIL_001_SQL = readFileSync(new URL('./migrations/001-mail.sql', import.meta.url), 'utf8');
const MAIL_002_SQL = readFileSync(new URL('./migrations/002-mail-attachment-blobs.sql', import.meta.url), 'utf8');
const MIGRATIONS = Object.freeze([
  Object.freeze({ version: 1, name: 'mail', sql: MAIL_001_SQL }),
  Object.freeze({ version: 2, name: 'mail_attachment_blobs', sql: MAIL_002_SQL }),
]);
const ID = /^[A-Za-z0-9._:-]{1,300}$/u;
const ATTACHMENT_STATUS = new Set(['inspectable', 'quarantined', 'blocked']);

function migrationChecksum(migration) {
  return createHash('sha256').update(`${migration.version}\0${migration.name}\0${migration.sql}`).digest('hex');
}

export function applyMailMigrations(db) {
  if (!db?.exec || !db?.prepare || !db?.transaction) throw new TypeError('mail_database_required');
  db.exec(`
    CREATE TABLE IF NOT EXISTS mail_schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    ) STRICT
  `);
  const findMigration = db.prepare('SELECT name, checksum FROM mail_schema_migrations WHERE version = ?');
  const insertMigration = db.prepare('INSERT INTO mail_schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)');
  for (const migration of MIGRATIONS) {
    const checksum = migrationChecksum(migration);
    const existing = findMigration.get(migration.version);
    if (existing) {
      if (existing.name !== migration.name || existing.checksum !== checksum) throw new Error(`mail_migration_checksum_mismatch:${migration.version}`);
      continue;
    }
    db.transaction(() => {
      db.exec(migration.sql);
      insertMigration.run(migration.version, migration.name, checksum, Date.now());
    })();
  }
}

export function createMailRepository({ db, encryptionKey } = {}) {
  const key = Buffer.from(encryptionKey ?? []);
  if (!db?.prepare || key.length !== 32) throw new TypeError('mail_repository_configuration_required');

  const insertMessage = db.prepare(`
    INSERT INTO mail_messages (message_id, account_id, provider, dedup_key, received_at, body_ciphertext, created_at)
    VALUES (@messageId, @accountId, @provider, @dedupKey, @receivedAt, @bodyCiphertext, @createdAt)
  `);
  const findByDedupKey = db.prepare('SELECT * FROM mail_messages WHERE dedup_key = ?');
  const findById = db.prepare('SELECT * FROM mail_messages WHERE message_id = ?');
  const upsertAttachment = db.prepare(`
    INSERT INTO mail_attachments (digest, detected_type, status, size_bytes, first_seen_at)
    VALUES (@digest, @detectedType, @status, @sizeBytes, @firstSeenAt)
    ON CONFLICT(digest) DO NOTHING
  `);
  const findAttachment = db.prepare('SELECT * FROM mail_attachments WHERE digest = ?');
  const upsertAttachmentBlob = db.prepare(`
    INSERT INTO mail_attachment_blobs (digest, bytes_ciphertext, created_at)
    VALUES (@digest, @bytesCiphertext, @createdAt)
    ON CONFLICT(digest) DO NOTHING
  `);
  const findAttachmentBlob = db.prepare('SELECT bytes_ciphertext FROM mail_attachment_blobs WHERE digest = ?');
  const linkAttachmentStmt = db.prepare(`
    INSERT INTO mail_message_attachments (message_id, digest, declared_filename)
    VALUES (@messageId, @digest, @declaredFilename)
    ON CONFLICT(message_id, digest) DO NOTHING
  `);
  const listAttachmentsForMessage = db.prepare(`
    SELECT a.digest, a.detected_type, a.status, a.size_bytes, m.declared_filename
    FROM mail_message_attachments m JOIN mail_attachments a ON a.digest = m.digest
    WHERE m.message_id = ?
  `);
  const getCursorStmt = db.prepare('SELECT cursor_json, paused FROM mail_sync_cursors WHERE account_id = ?');
  const upsertCursorStmt = db.prepare(`
    INSERT INTO mail_sync_cursors (account_id, folder, cursor_json, paused, updated_at)
    VALUES (@accountId, @folder, @cursorJson, @paused, @updatedAt)
    ON CONFLICT(account_id) DO UPDATE SET folder = excluded.folder, cursor_json = excluded.cursor_json, updated_at = excluded.updated_at
  `);
  const setPausedStmt = db.prepare(`
    INSERT INTO mail_sync_cursors (account_id, folder, cursor_json, paused, updated_at)
    VALUES (@accountId, 'INBOX', 'null', @paused, @updatedAt)
    ON CONFLICT(account_id) DO UPDATE SET paused = excluded.paused, updated_at = excluded.updated_at
  `);

  function attachmentsFor(messageId) {
    return listAttachmentsForMessage.all(messageId).map((row) => Object.freeze({
      digest: row.digest, detectedType: row.detected_type, status: row.status,
      sizeBytes: row.size_bytes, declaredFilename: row.declared_filename,
    }));
  }

  function rowToMessage(row) {
    if (!row) return null;
    const body = openRecord({ key, type: 'mail_message_body', id: row.message_id, ciphertext: row.body_ciphertext });
    return Object.freeze({
      messageId: row.message_id, accountId: row.account_id, provider: row.provider, dedupKey: row.dedup_key,
      receivedAt: row.received_at, ...body, attachments: Object.freeze(attachmentsFor(row.message_id)),
    });
  }

  return Object.freeze({
    async saveMessage(message) {
      if (!ID.test(message?.dedupKey ?? '') || typeof message?.accountId !== 'string' || typeof message?.provider !== 'string') {
        throw new TypeError('mail_message_invalid');
      }
      const existing = findByDedupKey.get(message.dedupKey);
      if (existing) return Object.freeze({ messageId: existing.message_id, saved: false, duplicate: true });

      const messageId = `${message.accountId}:${message.dedupKey}`;
      const { accountId, provider, dedupKey, receivedAt, ...body } = message;
      const bodyCiphertext = sealRecord({ key, type: 'mail_message_body', id: messageId, value: body });
      insertMessage.run({
        messageId, accountId, provider, dedupKey,
        receivedAt: Number.isSafeInteger(receivedAt) ? receivedAt : null,
        bodyCiphertext, createdAt: Date.now(),
      });
      return Object.freeze({ messageId, saved: true, duplicate: false });
    },

    async saveAttachment(descriptor) {
      if (typeof descriptor?.digest !== 'string' || !ATTACHMENT_STATUS.has(descriptor?.status)
        || !Number.isSafeInteger(descriptor?.sizeBytes) || descriptor.sizeBytes < 0) {
        throw new TypeError('mail_attachment_invalid');
      }
      const existing = findAttachment.get(descriptor.digest);
      upsertAttachment.run({
        digest: descriptor.digest, detectedType: descriptor.detectedType, status: descriptor.status,
        sizeBytes: descriptor.sizeBytes, firstSeenAt: Date.now(),
      });
      return Object.freeze({ digest: descriptor.digest, deduplicated: Boolean(existing) });
    },

    async saveAttachmentBlob({ digest, bytes } = {}) {
      if (typeof digest !== 'string' || !Buffer.isBuffer(bytes) || bytes.length < 1) throw new TypeError('mail_attachment_blob_invalid');
      const bytesCiphertext = sealRecord({
        key, type: 'mail_attachment_blob', id: digest, value: { bytesBase64: bytes.toString('base64') },
      });
      const result = upsertAttachmentBlob.run({ digest, bytesCiphertext, createdAt: Date.now() });
      return Object.freeze({ digest, saved: result.changes === 1 });
    },

    async getAttachmentBytes(digest) {
      if (typeof digest !== 'string') throw new TypeError('mail_attachment_digest_invalid');
      const row = findAttachmentBlob.get(digest);
      if (!row) return null;
      const opened = openRecord({ key, type: 'mail_attachment_blob', id: digest, ciphertext: row.bytes_ciphertext });
      if (typeof opened?.bytesBase64 !== 'string') throw new Error('mail_attachment_blob_invalid');
      return Buffer.from(opened.bytesBase64, 'base64');
    },

    async linkAttachment({ messageId, digest, declaredFilename } = {}) {
      if (typeof messageId !== 'string' || typeof digest !== 'string') throw new TypeError('mail_attachment_link_invalid');
      linkAttachmentStmt.run({ messageId, digest, declaredFilename: declaredFilename ?? null });
    },

    getMessageByDedupKey(dedupKey) {
      return rowToMessage(findByDedupKey.get(dedupKey));
    },

    getMessage(messageId) {
      return rowToMessage(findById.get(messageId));
    },

    getCursor(accountId) {
      const row = getCursorStmt.get(accountId);
      if (!row) return { cursor: null, paused: false };
      return { cursor: JSON.parse(row.cursor_json), paused: row.paused === 1 };
    },

    async saveCursor({ accountId, folder = 'INBOX', cursor } = {}) {
      if (typeof accountId !== 'string' || accountId.length < 1) throw new TypeError('mail_cursor_account_invalid');
      const current = getCursorStmt.get(accountId);
      upsertCursorStmt.run({
        accountId, folder, cursorJson: canonicalJson(cursor ?? null),
        paused: current ? current.paused : 0, updatedAt: Date.now(),
      });
    },

    async setPaused(accountId, paused) {
      if (typeof accountId !== 'string' || accountId.length < 1) throw new TypeError('mail_cursor_account_invalid');
      setPausedStmt.run({ accountId, paused: paused ? 1 : 0, updatedAt: Date.now() });
    },
  });
}
