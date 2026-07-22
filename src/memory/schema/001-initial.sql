CREATE TABLE memory_events (
  event_id TEXT PRIMARY KEY,
  version INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  event_type_hash BLOB NOT NULL,
  identity_hash BLOB,
  channel_hash BLOB,
  source_hash BLOB,
  ciphertext BLOB NOT NULL CHECK(length(ciphertext) > 0),
  content_size INTEGER NOT NULL CHECK(content_size >= 0),
  sync_state INTEGER NOT NULL DEFAULT 0
) STRICT;

CREATE TABLE memory_chunks (
  chunk_id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES memory_events(event_id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL CHECK(ordinal >= 0),
  created_at INTEGER NOT NULL,
  ciphertext BLOB NOT NULL CHECK(length(ciphertext) > 0),
  blind_index BLOB,
  embedding_ciphertext BLOB,
  content_size INTEGER NOT NULL CHECK(content_size >= 0),
  UNIQUE(event_id, ordinal)
) STRICT;

CREATE TABLE identities (
  identity_id TEXT PRIMARY KEY,
  identity_hash BLOB NOT NULL UNIQUE,
  ciphertext BLOB NOT NULL CHECK(length(ciphertext) > 0),
  created_at INTEGER NOT NULL
) STRICT;

CREATE TABLE identity_links (
  link_id TEXT PRIMARY KEY,
  identity_id TEXT NOT NULL REFERENCES identities(identity_id) ON DELETE CASCADE,
  link_hash BLOB NOT NULL UNIQUE,
  ciphertext BLOB NOT NULL CHECK(length(ciphertext) > 0),
  verified_at INTEGER NOT NULL
) STRICT;

CREATE TABLE sessions (
  session_id TEXT PRIMARY KEY,
  principal_hash BLOB,
  ciphertext BLOB NOT NULL CHECK(length(ciphertext) > 0),
  started_at INTEGER NOT NULL,
  ended_at INTEGER
) STRICT;

CREATE TABLE tombstones (
  tombstone_id TEXT PRIMARY KEY,
  target_hash BLOB NOT NULL UNIQUE,
  ciphertext BLOB NOT NULL CHECK(length(ciphertext) > 0),
  created_at INTEGER NOT NULL,
  sync_state INTEGER NOT NULL DEFAULT 0
) STRICT;

CREATE TABLE outbox_backup (
  outbox_id TEXT PRIMARY KEY,
  entity_type_hash BLOB NOT NULL,
  entity_id_hash BLOB NOT NULL,
  ciphertext BLOB NOT NULL CHECK(length(ciphertext) > 0),
  created_at INTEGER NOT NULL,
  sync_state INTEGER NOT NULL DEFAULT 0
) STRICT;

CREATE INDEX memory_events_identity_created_idx ON memory_events(identity_hash, created_at);
CREATE INDEX memory_chunks_event_ordinal_idx ON memory_chunks(event_id, ordinal);
CREATE INDEX outbox_backup_state_created_idx ON outbox_backup(sync_state, created_at);
