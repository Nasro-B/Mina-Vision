import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const SQL = readFileSync(new URL('./migrations/001-personal-graph.sql', import.meta.url), 'utf8');
const MIGRATION = Object.freeze({ version: 1, name: 'personal-graph', sql: SQL });

function migrationChecksum(migration) {
  return createHash('sha256').update(`${migration.version}\0${migration.name}\0${migration.sql}`).digest('hex');
}

export function applyPersonalGraphMigrations(db) {
  if (!db?.exec || !db?.prepare || !db?.transaction) throw new TypeError('personal_graph_database_required');
  db.exec(`
    CREATE TABLE IF NOT EXISTS personal_graph_schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    ) STRICT
  `);
  const checksum = migrationChecksum(MIGRATION);
  const existing = db.prepare('SELECT name, checksum FROM personal_graph_schema_migrations WHERE version = ?').get(MIGRATION.version);
  if (existing) {
    if (existing.name !== MIGRATION.name || existing.checksum !== checksum) throw new Error('personal_graph_migration_checksum_mismatch:1');
    return;
  }
  db.transaction(() => {
    db.exec(MIGRATION.sql);
    db.prepare('INSERT INTO personal_graph_schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)')
      .run(MIGRATION.version, MIGRATION.name, checksum, Date.now());
  })();
}

function rowToEntity(row) {
  if (!row) return null;
  return Object.freeze({
    entityId: row.entity_id,
    entityType: row.entity_type,
    displayName: row.display_name,
    attributes: Object.freeze(JSON.parse(row.attributes_json)),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function rowToEdge(row) {
  if (!row) return null;
  return Object.freeze({
    edgeId: row.edge_id,
    fromEntityId: row.from_entity_id,
    relationType: row.relation_type,
    toEntityId: row.to_entity_id,
    sourceRefs: Object.freeze(JSON.parse(row.source_refs_json)),
    observedAt: row.observed_at,
    confidence: row.confidence,
    classification: row.classification,
    status: row.status,
    disputeReason: row.dispute_reason ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export function createGraphRepository({ db, clock } = {}) {
  if (!db?.prepare) throw new TypeError('graph_repository_database_required');
  if (!clock || (typeof clock !== 'function' && typeof clock.now !== 'function')) {
    throw new TypeError('graph_repository_clock_required');
  }
  const now = () => Number(typeof clock === 'function' ? clock() : clock.now());

  const upsertEntity = db.prepare(`
    INSERT INTO graph_entities (entity_id, entity_type, display_name, attributes_json, created_at, updated_at)
    VALUES (@entityId, @entityType, @displayName, @attributesJson, @now, @now)
    ON CONFLICT(entity_id) DO UPDATE SET
      entity_type = excluded.entity_type, display_name = excluded.display_name,
      attributes_json = excluded.attributes_json, updated_at = excluded.updated_at
  `);
  const selectEntity = db.prepare('SELECT * FROM graph_entities WHERE entity_id = ?');
  const selectAllEntities = db.prepare('SELECT * FROM graph_entities');
  const deleteEntity = db.prepare('DELETE FROM graph_entities WHERE entity_id = ?');

  const insertEdge = db.prepare(`
    INSERT INTO graph_edges (edge_id, from_entity_id, relation_type, to_entity_id, source_refs_json, observed_at, confidence, classification, status, dispute_reason, created_at, updated_at)
    VALUES (@edgeId, @fromEntityId, @relationType, @toEntityId, @sourceRefsJson, @observedAt, @confidence, @classification, @status, NULL, @now, @now)
  `);
  const selectEdge = db.prepare('SELECT * FROM graph_edges WHERE edge_id = ?');
  const updateEdgeStatus = db.prepare('UPDATE graph_edges SET status = @status, dispute_reason = @disputeReason, updated_at = @updatedAt WHERE edge_id = @edgeId');
  const selectEdgesByEntity = db.prepare('SELECT * FROM graph_edges WHERE from_entity_id = @entityId OR to_entity_id = @entityId');
  const selectEdgesByStatus = db.prepare('SELECT * FROM graph_edges WHERE status = ?');
  const deleteEdgesByEntity = db.prepare('DELETE FROM graph_edges WHERE from_entity_id = @entityId OR to_entity_id = @entityId');
  const selectEdgesFrom = db.prepare("SELECT * FROM graph_edges WHERE from_entity_id = @entityId AND status = 'confirmed'");
  const selectEdgesTo = db.prepare("SELECT * FROM graph_edges WHERE to_entity_id = @entityId AND status = 'confirmed'");

  return Object.freeze({
    async putEntity(entity) {
      upsertEntity.run({
        entityId: entity.entityId, entityType: entity.entityType, displayName: entity.displayName,
        attributesJson: JSON.stringify(entity.attributes ?? {}), now: now(),
      });
      return rowToEntity(selectEntity.get(entity.entityId));
    },

    async getEntity(entityId) {
      return rowToEntity(selectEntity.get(entityId));
    },

    async listEntities() {
      return Object.freeze(selectAllEntities.all().map(rowToEntity));
    },

    async findByAttribute(field, value) {
      const rows = selectAllEntities.all().filter((row) => {
        const attributes = JSON.parse(row.attributes_json);
        return attributes[field] === value;
      });
      return Object.freeze(rows.map(rowToEntity));
    },

    async deleteEntity(entityId) {
      deleteEdgesByEntity.run({ entityId });
      deleteEntity.run(entityId);
    },

    async putEdge(edge) {
      insertEdge.run({
        edgeId: edge.edgeId, fromEntityId: edge.fromEntityId, relationType: edge.relationType, toEntityId: edge.toEntityId,
        sourceRefsJson: JSON.stringify(edge.sourceRefs ?? []), observedAt: edge.observedAt, confidence: edge.confidence,
        classification: edge.classification, status: edge.status, now: now(),
      });
      return rowToEdge(selectEdge.get(edge.edgeId));
    },

    async getEdge(edgeId) {
      return rowToEdge(selectEdge.get(edgeId));
    },

    async updateEdgeStatus(edgeId, status, disputeReason = null) {
      updateEdgeStatus.run({ edgeId, status, disputeReason, updatedAt: now() });
      return rowToEdge(selectEdge.get(edgeId));
    },

    async listEdgesForEntity(entityId) {
      return Object.freeze(selectEdgesByEntity.all({ entityId }).map(rowToEdge));
    },

    async listEdgesByStatus(status) {
      return Object.freeze(selectEdgesByStatus.all(status).map(rowToEdge));
    },

    async listConfirmedNeighbors(entityId) {
      return Object.freeze([...selectEdgesFrom.all({ entityId }), ...selectEdgesTo.all({ entityId })].map(rowToEdge));
    },
  });
}
