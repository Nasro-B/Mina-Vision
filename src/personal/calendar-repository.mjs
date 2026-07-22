import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const SQL = readFileSync(new URL('./migrations/001-personal-calendar.sql', import.meta.url), 'utf8');
const MIGRATION = Object.freeze({ version: 1, name: 'personal-calendar', sql: SQL });

function migrationChecksum(migration) {
  return createHash('sha256').update(`${migration.version}\0${migration.name}\0${migration.sql}`).digest('hex');
}

export function applyPersonalCalendarMigrations(db) {
  if (!db?.exec || !db?.prepare || !db?.transaction) throw new TypeError('personal_calendar_database_required');
  db.exec(`
    CREATE TABLE IF NOT EXISTS personal_calendar_schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    ) STRICT
  `);
  const checksum = migrationChecksum(MIGRATION);
  const existing = db.prepare('SELECT name, checksum FROM personal_calendar_schema_migrations WHERE version = ?').get(MIGRATION.version);
  if (existing) {
    if (existing.name !== MIGRATION.name || existing.checksum !== checksum) throw new Error('personal_calendar_migration_checksum_mismatch:1');
    return;
  }
  db.transaction(() => {
    db.exec(MIGRATION.sql);
    db.prepare('INSERT INTO personal_calendar_schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)')
      .run(MIGRATION.version, MIGRATION.name, checksum, Date.now());
  })();
}

function rowToEvent(row) {
  if (!row) return null;
  return Object.freeze({
    eventId: row.event_id,
    providerId: row.provider_id,
    calendarId: row.calendar_id,
    title: row.title,
    description: row.description,
    location: row.location,
    startAt: new Date(row.start_at).toISOString(),
    endAt: new Date(row.end_at).toISOString(),
    allDay: Boolean(row.all_day),
    attendees: Object.freeze(JSON.parse(row.attendees_json)),
    revision: row.revision,
    syncedAt: row.synced_at,
  });
}

export function createCalendarRepository({ db, clock } = {}) {
  if (!db?.prepare) throw new TypeError('calendar_repository_database_required');
  if (!clock || (typeof clock !== 'function' && typeof clock.now !== 'function')) {
    throw new TypeError('calendar_repository_clock_required');
  }
  const now = () => Number(typeof clock === 'function' ? clock() : clock.now());

  const upsert = db.prepare(`
    INSERT INTO calendar_events (event_id, provider_id, calendar_id, title, description, location, start_at, end_at, all_day, attendees_json, revision, synced_at)
    VALUES (@eventId, @providerId, @calendarId, @title, @description, @location, @startAt, @endAt, @allDay, @attendeesJson, @revision, @syncedAt)
    ON CONFLICT(event_id) DO UPDATE SET
      provider_id = excluded.provider_id, calendar_id = excluded.calendar_id, title = excluded.title,
      description = excluded.description, location = excluded.location, start_at = excluded.start_at, end_at = excluded.end_at,
      all_day = excluded.all_day, attendees_json = excluded.attendees_json, revision = excluded.revision, synced_at = excluded.synced_at
  `);
  const selectById = db.prepare('SELECT * FROM calendar_events WHERE event_id = ?');
  const deleteById = db.prepare('DELETE FROM calendar_events WHERE event_id = ?');
  const selectRange = db.prepare('SELECT * FROM calendar_events WHERE start_at < @to AND end_at > @from ORDER BY start_at ASC');
  const selectRangeByProvider = db.prepare('SELECT * FROM calendar_events WHERE provider_id = @providerId AND start_at < @to AND end_at > @from ORDER BY start_at ASC');
  const selectCursor = db.prepare('SELECT cursor_json FROM calendar_sync_cursors WHERE provider_id = ?');
  const upsertCursor = db.prepare(`
    INSERT INTO calendar_sync_cursors (provider_id, cursor_json, updated_at) VALUES (@providerId, @cursorJson, @updatedAt)
    ON CONFLICT(provider_id) DO UPDATE SET cursor_json = excluded.cursor_json, updated_at = excluded.updated_at
  `);

  return Object.freeze({
    async put(event) {
      upsert.run({
        eventId: event.eventId, providerId: event.providerId, calendarId: event.calendarId, title: event.title,
        description: event.description ?? '', location: event.location ?? '',
        startAt: Date.parse(event.startAt), endAt: Date.parse(event.endAt), allDay: event.allDay ? 1 : 0,
        attendeesJson: JSON.stringify(event.attendees ?? []), revision: event.revision, syncedAt: now(),
      });
      return rowToEvent(selectById.get(event.eventId));
    },

    async get(eventId) {
      return rowToEvent(selectById.get(eventId));
    },

    async delete(eventId) {
      deleteById.run(eventId);
    },

    async list({ from, to, providerId } = {}) {
      const params = { from: Date.parse(from), to: Date.parse(to) };
      const rows = providerId ? selectRangeByProvider.all({ ...params, providerId }) : selectRange.all(params);
      return Object.freeze(rows.map(rowToEvent));
    },

    async getCursor(providerId) {
      const row = selectCursor.get(providerId);
      return row ? JSON.parse(row.cursor_json) : null;
    },

    async setCursor(providerId, cursor) {
      upsertCursor.run({ providerId, cursorJson: JSON.stringify(cursor), updatedAt: now() });
    },
  });
}
