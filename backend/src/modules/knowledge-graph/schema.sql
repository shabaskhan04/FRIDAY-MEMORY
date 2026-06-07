-- ============================================================
-- Friday AIOS Knowledge Graph Schema
-- Supabase/PostgreSQL
-- ============================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ============================================================
-- ENUM TYPES
-- ============================================================

CREATE TYPE node_type AS ENUM (
  'PERSON', 'PROJECT', 'BUSINESS', 'GOAL', 'TASK',
  'EVENT', 'LOCATION', 'MEMORY', 'HEALTH_METRIC',
  'CONCEPT', 'DOCUMENT', 'CUSTOM'
);

CREATE TYPE relationship_type AS ENUM (
  'OWNS', 'WORKS_ON', 'CONNECTED_TO', 'MENTIONED_WITH',
  'FRIEND_OF', 'CLIENT_OF', 'RELATED_TO', 'PART_OF',
  'LOCATED_IN', 'DEPENDS_ON', 'CAUSED_BY', 'GOAL_OF',
  'TRACKS', 'ATTENDED', 'INTERESTED_IN', 'SPOKE_WITH',
  'REQUESTED', 'MANAGES', 'CREATED', 'EMPLOYED_BY'
);

CREATE TYPE event_type AS ENUM (
  'NODE_CREATED', 'NODE_UPDATED', 'NODE_MERGED',
  'EDGE_CREATED', 'EDGE_UPDATED', 'EDGE_REMOVED',
  'SNAPSHOT_TAKEN', 'SCORE_UPDATED'
);

-- ============================================================
-- GRAPH NODES
-- ============================================================

CREATE TABLE graph_nodes (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  node_type      node_type NOT NULL,
  name           TEXT NOT NULL,
  description    TEXT,
  aliases        TEXT[]          DEFAULT '{}',
  metadata       JSONB           DEFAULT '{}',
  importance_score   FLOAT       DEFAULT 0.5  CHECK (importance_score BETWEEN 0 AND 1),
  confidence_score   FLOAT       DEFAULT 1.0  CHECK (confidence_score BETWEEN 0 AND 1),
  mention_count  INT             DEFAULT 1,
  last_mentioned_at  TIMESTAMPTZ DEFAULT NOW(),
  embedding      VECTOR(1536),   -- for semantic dedup & search
  source_memory_ids  UUID[]      DEFAULT '{}',
  is_archived    BOOLEAN         DEFAULT FALSE,
  created_at     TIMESTAMPTZ     DEFAULT NOW(),
  updated_at     TIMESTAMPTZ     DEFAULT NOW()
);

-- ============================================================
-- GRAPH EDGES
-- ============================================================

CREATE TABLE graph_edges (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_node_id   UUID NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
  target_node_id   UUID NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
  relationship_type relationship_type NOT NULL,
  strength         FLOAT           DEFAULT 0.5  CHECK (strength BETWEEN 0 AND 1),
  confidence       FLOAT           DEFAULT 1.0  CHECK (confidence BETWEEN 0 AND 1),
  mention_count    INT             DEFAULT 1,
  last_seen_at     TIMESTAMPTZ     DEFAULT NOW(),
  metadata         JSONB           DEFAULT '{}',
  source_memory_ids UUID[]         DEFAULT '{}',
  is_archived      BOOLEAN         DEFAULT FALSE,
  created_at       TIMESTAMPTZ     DEFAULT NOW(),
  updated_at       TIMESTAMPTZ     DEFAULT NOW(),

  CONSTRAINT no_self_loops CHECK (source_node_id != target_node_id),
  CONSTRAINT unique_edge UNIQUE (user_id, source_node_id, target_node_id, relationship_type)
);

-- ============================================================
-- GRAPH SNAPSHOTS
-- Periodic full-graph state captures for diffing and rollback
-- ============================================================

CREATE TABLE graph_snapshots (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  snapshot     JSONB NOT NULL,   -- { nodes: [...], edges: [...] }
  node_count   INT  NOT NULL,
  edge_count   INT  NOT NULL,
  trigger      TEXT,             -- 'weekly_digest' | 'manual' | 'auto'
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- GRAPH EVENTS
-- Immutable audit log for every mutation
-- ============================================================

CREATE TABLE graph_events (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_type   event_type NOT NULL,
  entity_id    UUID,             -- node or edge id affected
  entity_kind  TEXT,             -- 'node' | 'edge'
  payload      JSONB DEFAULT '{}',
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- INDEXES
-- ============================================================

-- Node lookup
CREATE INDEX idx_nodes_user_id        ON graph_nodes(user_id);
CREATE INDEX idx_nodes_type           ON graph_nodes(user_id, node_type);
CREATE INDEX idx_nodes_name_trgm      ON graph_nodes USING GIN (name gin_trgm_ops);
CREATE INDEX idx_nodes_aliases        ON graph_nodes USING GIN (aliases);
CREATE INDEX idx_nodes_importance     ON graph_nodes(user_id, importance_score DESC);
CREATE INDEX idx_nodes_last_mentioned ON graph_nodes(user_id, last_mentioned_at DESC);
CREATE INDEX idx_nodes_embedding      ON graph_nodes USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX idx_nodes_metadata       ON graph_nodes USING GIN (metadata);

-- Edge traversal (both directions)
CREATE INDEX idx_edges_user_id        ON graph_edges(user_id);
CREATE INDEX idx_edges_source         ON graph_edges(user_id, source_node_id);
CREATE INDEX idx_edges_target         ON graph_edges(user_id, target_node_id);
CREATE INDEX idx_edges_rel_type       ON graph_edges(user_id, relationship_type);
CREATE INDEX idx_edges_strength       ON graph_edges(user_id, strength DESC);
CREATE INDEX idx_edges_last_seen      ON graph_edges(user_id, last_seen_at DESC);

-- Events + snapshots
CREATE INDEX idx_events_user_entity   ON graph_events(user_id, entity_id);
CREATE INDEX idx_events_type          ON graph_events(user_id, event_type);
CREATE INDEX idx_events_created       ON graph_events(user_id, created_at DESC);
CREATE INDEX idx_snapshots_user       ON graph_snapshots(user_id, created_at DESC);

-- ============================================================
-- TRIGGERS: auto-update updated_at
-- ============================================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_nodes_updated_at
  BEFORE UPDATE ON graph_nodes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_edges_updated_at
  BEFORE UPDATE ON graph_edges
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- FUNCTION: graph neighborhood (recursive CTE up to N hops)
-- ============================================================

CREATE OR REPLACE FUNCTION get_node_neighborhood(
  p_user_id   UUID,
  p_node_id   UUID,
  p_max_depth INT DEFAULT 2
)
RETURNS TABLE(
  node_id     UUID,
  depth       INT,
  path        UUID[]
) LANGUAGE sql STABLE AS $$
  WITH RECURSIVE neighbors AS (
    SELECT p_node_id AS node_id, 0 AS depth, ARRAY[p_node_id] AS path
    UNION ALL
    SELECT
      CASE WHEN e.source_node_id = n.node_id THEN e.target_node_id
           ELSE e.source_node_id END,
      n.depth + 1,
      n.path || CASE WHEN e.source_node_id = n.node_id THEN e.target_node_id
                     ELSE e.source_node_id END
    FROM neighbors n
    JOIN graph_edges e
      ON (e.source_node_id = n.node_id OR e.target_node_id = n.node_id)
      AND e.user_id = p_user_id
      AND e.is_archived = FALSE
    WHERE n.depth < p_max_depth
      AND NOT (CASE WHEN e.source_node_id = n.node_id THEN e.target_node_id
                    ELSE e.source_node_id END = ANY(n.path))
  )
  SELECT DISTINCT node_id, MIN(depth) AS depth, MIN(path) AS path
  FROM neighbors
  GROUP BY node_id;
$$;
