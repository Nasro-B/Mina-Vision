CREATE TABLE graph_entities (
  entity_id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  display_name TEXT NOT NULL,
  attributes_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE TABLE graph_edges (
  edge_id TEXT PRIMARY KEY,
  from_entity_id TEXT NOT NULL REFERENCES graph_entities(entity_id),
  relation_type TEXT NOT NULL,
  to_entity_id TEXT NOT NULL REFERENCES graph_entities(entity_id),
  source_refs_json TEXT NOT NULL DEFAULT '[]',
  observed_at INTEGER NOT NULL,
  confidence REAL NOT NULL,
  classification TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('proposed', 'confirmed', 'disputed')),
  dispute_reason TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE INDEX graph_edges_from_idx ON graph_edges(from_entity_id);
CREATE INDEX graph_edges_to_idx ON graph_edges(to_entity_id);
CREATE INDEX graph_edges_status_idx ON graph_edges(status);
