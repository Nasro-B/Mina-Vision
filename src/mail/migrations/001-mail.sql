CREATE TABLE mail_messages (
  message_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  dedup_key TEXT NOT NULL UNIQUE,
  received_at INTEGER,
  body_ciphertext BLOB NOT NULL,
  created_at INTEGER NOT NULL
) STRICT;

CREATE INDEX mail_messages_account_idx ON mail_messages(account_id);

CREATE TABLE mail_attachments (
  digest TEXT PRIMARY KEY,
  detected_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('inspectable', 'quarantined', 'blocked')),
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  first_seen_at INTEGER NOT NULL
) STRICT;

CREATE TABLE mail_message_attachments (
  message_id TEXT NOT NULL REFERENCES mail_messages(message_id),
  digest TEXT NOT NULL REFERENCES mail_attachments(digest),
  declared_filename TEXT,
  PRIMARY KEY (message_id, digest)
) STRICT;

CREATE TABLE mail_sync_cursors (
  account_id TEXT PRIMARY KEY,
  folder TEXT NOT NULL,
  cursor_json TEXT NOT NULL,
  paused INTEGER NOT NULL DEFAULT 0 CHECK (paused IN (0, 1)),
  updated_at INTEGER NOT NULL
) STRICT;
