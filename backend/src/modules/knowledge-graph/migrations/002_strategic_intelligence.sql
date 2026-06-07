-- ============================================================
-- Migration 002: Strategic Intelligence Layer
-- P1: Canonical entities + canonical_id on nodes
-- P2: Structured snapshots
-- P5: Contradiction event log
-- P6: source_count on nodes + edges
-- ============================================================

-- ---- P1: Canonical entity registry -----------------------

CREATE TABLE graph_canonical_entities (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  canonical_id TEXT        NOT NULL,   -- e.g. 'PROJECT_ORIN', never changes
  display_name TEXT        NOT NULL,
  entity_type  TEXT        NOT NULL,   -- mirrors node_type values
  description  TEXT,
  aliases      TEXT[]      DEFAULT '{}',
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_canonical_per_user UNIQUE (user_id, canonical_id)
);

CREATE INDEX idx_canonical_user      ON graph_canonical_entities(user_id);
CREATE INDEX idx_canonical_id        ON graph_canonical_entities(user_id, canonical_id);
CREATE INDEX idx_canonical_type      ON graph_canonical_entities(user_id, entity_type);
CREATE INDEX idx_canonical_aliases   ON graph_canonical_entities USING GIN (aliases);

CREATE TRIGGER trg_canonical_updated_at
  BEFORE UPDATE ON graph_canonical_entities
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Add canonical_id FK to graph_nodes (nullable — not all nodes are canonical yet)
ALTER TABLE graph_nodes
  ADD COLUMN IF NOT EXISTS canonical_id TEXT;

CREATE INDEX idx_nodes_canonical_id
  ON graph_nodes(user_id, canonical_id)
  WHERE canonical_id IS NOT NULL;

-- ---- P2: Extend graph_snapshots with structured summary ---

ALTER TABLE graph_snapshots
  ADD COLUMN IF NOT EXISTS top_entities  JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS top_projects  JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS top_people    JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS top_goals     JSONB DEFAULT '[]';

-- ---- P6: source_count on nodes + edges -------------------

ALTER TABLE graph_nodes
  ADD COLUMN IF NOT EXISTS source_count INT DEFAULT 1;

ALTER TABLE graph_edges
  ADD COLUMN IF NOT EXISTS source_count INT DEFAULT 1;

-- ---- P5: Contradiction event type -----------------------

ALTER TYPE event_type ADD VALUE IF NOT EXISTS 'CONTRADICTION_DETECTED';

-- ---- Convenience: find all nodes for a canonical_id -----

CREATE OR REPLACE FUNCTION get_nodes_by_canonical(
  p_user_id      UUID,
  p_canonical_id TEXT
)
RETURNS SETOF graph_nodes LANGUAGE sql STABLE AS $$
  SELECT * FROM graph_nodes
  WHERE user_id     = p_user_id
    AND canonical_id = p_canonical_id
    AND is_archived  = FALSE;
$$;
