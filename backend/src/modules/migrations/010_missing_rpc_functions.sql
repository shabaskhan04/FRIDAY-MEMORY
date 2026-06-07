-- ============================================================
-- Migration 010: Missing RPC Functions
--
-- Defines four PostgreSQL functions called by GraphRepository
-- but absent from all prior migrations and schema.sql:
--
--   1. search_nodes_fuzzy       — fuzzy trigram name search
--   2. search_nodes_semantic    — pgvector cosine similarity search
--   3. increment_node_mention   — atomic mention_count + last_mentioned_at update
--   4. increment_edge_mention   — atomic mention_count + last_seen_at update
--
-- Dependencies:
--   - pg_trgm extension (enabled in schema.sql)
--   - vector extension (enabled in schema.sql)
--   - graph_nodes table (created in schema.sql)
--   - graph_edges table (created in schema.sql)
--
-- Migration order: run after 009_ai_cost.sql
-- ============================================================


-- ============================================================
-- 1. search_nodes_fuzzy
--
-- Used by: GraphRepository.fuzzyFindNodes()
-- Call:    .rpc('search_nodes_fuzzy', { p_user_id, p_name, p_threshold })
--
-- Performs trigram similarity search on node names.
-- Returns nodes where similarity(name, p_name) >= p_threshold,
-- ordered by similarity descending.
-- ============================================================

CREATE OR REPLACE FUNCTION search_nodes_fuzzy(
  p_user_id   UUID,
  p_name      TEXT,
  p_threshold FLOAT DEFAULT 0.3
)
RETURNS SETOF graph_nodes
LANGUAGE sql STABLE AS $$
  SELECT *
  FROM graph_nodes
  WHERE user_id     = p_user_id
    AND is_archived = FALSE
    AND similarity(name, p_name) >= p_threshold
  ORDER BY similarity(name, p_name) DESC;
$$;


-- ============================================================
-- 2. search_nodes_semantic
--
-- Used by: GraphRepository.semanticSearchNodes()
-- Call:    .rpc('search_nodes_semantic', { p_user_id, p_embedding, p_limit, p_min_score })
--
-- Performs cosine similarity search against node embeddings.
-- p_embedding is passed as a JSON array string and cast to vector.
-- Returns nodes with an extra `similarity` column.
-- ============================================================

CREATE OR REPLACE FUNCTION search_nodes_semantic(
  p_user_id   UUID,
  p_embedding TEXT,          -- JSON array string: "[0.1, 0.2, ...]"
  p_limit     INT   DEFAULT 10,
  p_min_score FLOAT DEFAULT 0.7
)
-- Column order matches physical graph_nodes column order post-migrations
-- (schema.sql → 001_add_pinned_locked → 002_strategic_intelligence)
-- similarity appended last.
RETURNS TABLE(
  id                UUID,
  user_id           UUID,
  node_type         node_type,
  name              TEXT,
  description       TEXT,
  aliases           TEXT[],
  metadata          JSONB,
  importance_score  FLOAT,
  confidence_score  FLOAT,
  mention_count     INT,
  last_mentioned_at TIMESTAMPTZ,
  embedding         VECTOR(1536),
  source_memory_ids UUID[],
  is_archived       BOOLEAN,
  created_at        TIMESTAMPTZ,
  updated_at        TIMESTAMPTZ,
  is_locked         BOOLEAN,
  canonical_id      TEXT,
  source_count      INT,
  similarity        FLOAT
)
LANGUAGE sql STABLE AS $$
  SELECT
    n.id,
    n.user_id,
    n.node_type,
    n.name,
    n.description,
    n.aliases,
    n.metadata,
    n.importance_score,
    n.confidence_score,
    n.mention_count,
    n.last_mentioned_at,
    n.embedding,
    n.source_memory_ids,
    n.is_archived,
    n.created_at,
    n.updated_at,
    n.is_locked,
    n.canonical_id,
    n.source_count,
    1 - (n.embedding <=> p_embedding::vector) AS similarity
  FROM graph_nodes n
  WHERE n.user_id     = p_user_id
    AND n.is_archived = FALSE
    AND n.embedding   IS NOT NULL
    AND 1 - (n.embedding <=> p_embedding::vector) >= p_min_score
  ORDER BY n.embedding <=> p_embedding::vector
  LIMIT p_limit;
$$;


-- ============================================================
-- 3. increment_node_mention
--
-- Used by: GraphRepository.incrementMentionCount()
-- Call:    .rpc('increment_node_mention', { p_node_id, p_user_id })
--
-- Atomically increments mention_count and sets last_mentioned_at = NOW().
-- Single UPDATE — no race condition vs. read-then-write.
-- ============================================================

CREATE OR REPLACE FUNCTION increment_node_mention(
  p_node_id UUID,
  p_user_id UUID
)
RETURNS VOID
LANGUAGE sql AS $$
  UPDATE graph_nodes
  SET
    mention_count     = mention_count + 1,
    last_mentioned_at = NOW(),
    updated_at        = NOW()
  WHERE id      = p_node_id
    AND user_id = p_user_id;
$$;


-- ============================================================
-- 4. increment_edge_mention
--
-- Used by: GraphRepository.incrementEdgeMention()
-- Call:    .rpc('increment_edge_mention', { p_edge_id, p_user_id })
--
-- Atomically increments mention_count and sets last_seen_at = NOW().
-- ============================================================

CREATE OR REPLACE FUNCTION increment_edge_mention(
  p_edge_id UUID,
  p_user_id UUID
)
RETURNS VOID
LANGUAGE sql AS $$
  UPDATE graph_edges
  SET
    mention_count = mention_count + 1,
    last_seen_at  = NOW(),
    updated_at    = NOW()
  WHERE id      = p_edge_id
    AND user_id = p_user_id;
$$;


-- ============================================================
-- Indexes
--
-- search_nodes_fuzzy already benefits from:
--   idx_nodes_name_trgm  (GIN gin_trgm_ops on name) — created in schema.sql
--
-- search_nodes_semantic already benefits from:
--   idx_nodes_embedding  (ivfflat vector_cosine_ops) — created in schema.sql
--
-- increment_node_mention / increment_edge_mention use PK lookups:
--   graph_nodes.id (PK) + user_id — no additional index needed.
-- ============================================================

-- ============================================================
-- Grants
-- Required for Supabase PostgREST (authenticated role) to call
-- these functions via .rpc(). Service role bypasses RLS and
-- already has superuser-equivalent grants.
-- ============================================================

GRANT EXECUTE ON FUNCTION search_nodes_fuzzy(UUID, TEXT, FLOAT)
  TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION search_nodes_semantic(UUID, TEXT, INT, FLOAT)
  TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION increment_node_mention(UUID, UUID)
  TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION increment_edge_mention(UUID, UUID)
  TO authenticated, service_role;
