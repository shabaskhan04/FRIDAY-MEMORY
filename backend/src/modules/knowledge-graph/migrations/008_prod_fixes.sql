-- ============================================================
-- Migration 008: Production-readiness fixes
-- C-4: Atomic edge upsert with strength boost
-- H-4: Drop full-graph JSONB from snapshots
-- H-8: Add user_id to decision_entities
-- L-6: Add user_id + composite index to review_recommendations
-- ============================================================

-- C-4: Atomic edge upsert — no more check-then-update race
CREATE OR REPLACE FUNCTION upsert_edge_atomic(
  p_user_id          UUID,
  p_source_node_id   UUID,
  p_target_node_id   UUID,
  p_relationship_type TEXT,
  p_strength         FLOAT,
  p_confidence       FLOAT,
  p_source_memory_ids UUID[],
  p_metadata         JSONB,
  p_is_pinned        BOOLEAN DEFAULT FALSE
) RETURNS graph_edges LANGUAGE plpgsql AS $$
DECLARE
  result graph_edges;
BEGIN
  INSERT INTO graph_edges (
    user_id, source_node_id, target_node_id, relationship_type,
    strength, confidence, source_memory_ids, metadata, is_pinned
  ) VALUES (
    p_user_id, p_source_node_id, p_target_node_id, p_relationship_type,
    p_strength, p_confidence, p_source_memory_ids, p_metadata, p_is_pinned
  )
  ON CONFLICT (user_id, source_node_id, target_node_id, relationship_type)
  DO UPDATE SET
    strength          = LEAST(1.0, graph_edges.strength + (1.0 - graph_edges.strength) * 0.15),
    mention_count     = graph_edges.mention_count + 1,
    last_seen_at      = NOW(),
    source_memory_ids = graph_edges.source_memory_ids || EXCLUDED.source_memory_ids,
    updated_at        = NOW()
  RETURNING * INTO result;
  RETURN result;
END;
$$;

-- H-4: Remove full-graph JSONB blob — too large at scale.
-- Summaries already exist in top_entities/top_projects/top_people/top_goals columns.
-- The snapshot column is retained but will only store node_count + edge_count metadata,
-- not full node/edge arrays. Existing rows are migrated to strip the arrays.
UPDATE graph_snapshots
  SET snapshot = jsonb_build_object(
    'node_count', node_count,
    'edge_count',  edge_count
  )
  WHERE snapshot ? 'nodes';

-- After migration, applications should no longer write nodes/edges into snapshot.
-- A comment constraint enforces this at the doc level:
COMMENT ON COLUMN graph_snapshots.snapshot IS
  'Lightweight metadata only. Full graph is NOT stored here. Use graph_nodes/graph_edges directly.';

-- H-8: Add user_id to decision_entities for RLS + query safety
ALTER TABLE decision_entities
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- Backfill from parent decisions table
UPDATE decision_entities de
  SET user_id = d.user_id
  FROM decisions d
  WHERE de.decision_id = d.id
    AND de.user_id IS NULL;

-- Make non-nullable after backfill
ALTER TABLE decision_entities ALTER COLUMN user_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_de_user ON decision_entities(user_id);

-- L-6: Add user_id to review_recommendations + composite index
ALTER TABLE review_recommendations
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

UPDATE review_recommendations rr
  SET user_id = sr.user_id
  FROM strategic_reviews sr
  WHERE rr.review_id = sr.id
    AND rr.user_id IS NULL;

ALTER TABLE review_recommendations ALTER COLUMN user_id SET NOT NULL;

DROP INDEX IF EXISTS idx_recs_entity;
CREATE INDEX idx_recs_user_entity ON review_recommendations(user_id, entity_name);
