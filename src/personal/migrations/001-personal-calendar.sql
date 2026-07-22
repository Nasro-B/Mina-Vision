CREATE TABLE calendar_events (
  event_id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL,
  calendar_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  start_at INTEGER NOT NULL,
  end_at INTEGER NOT NULL,
  all_day INTEGER NOT NULL DEFAULT 0 CHECK (all_day IN (0, 1)),
  attendees_json TEXT NOT NULL DEFAULT '[]',
  revision TEXT NOT NULL,
  synced_at INTEGER NOT NULL
) STRICT;

CREATE INDEX calendar_events_provider_idx ON calendar_events(provider_id);
CREATE INDEX calendar_events_start_idx ON calendar_events(start_at);

CREATE TABLE calendar_sync_cursors (
  provider_id TEXT PRIMARY KEY,
  cursor_json TEXT,
  updated_at INTEGER NOT NULL
) STRICT;
