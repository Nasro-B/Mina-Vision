CREATE TABLE mail_attachment_blobs (
  digest TEXT PRIMARY KEY REFERENCES mail_attachments(digest),
  bytes_ciphertext BLOB NOT NULL,
  created_at INTEGER NOT NULL
) STRICT;
