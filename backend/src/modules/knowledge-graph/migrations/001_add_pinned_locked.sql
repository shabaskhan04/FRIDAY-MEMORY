-- ============================================================
-- Migration: T8 + T9 additions
-- Add is_pinned to graph_edges
-- Add is_locked to graph_nodes
-- Add EDGE_PINNED / EDGE_UNPINNED to event_type enum
-- ============================================================

-- T9: locked nodes
ALTER TABLE graph_nodes
  ADD COLUMN IF NOT EXISTS is_locked BOOLEAN DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_nodes_locked
  ON graph_nodes(user_id, is_locked)
  WHERE is_locked = TRUE;

-- T1 + T8: pinned edges
ALTER TABLE graph_edges
  ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_edges_pinned
  ON graph_edges(user_id, is_pinned)
  WHERE is_pinned = TRUE;

-- T8: new event types
ALTER TYPE event_type ADD VALUE IF NOT EXISTS 'EDGE_PINNED';
ALTER TYPE event_type ADD VALUE IF NOT EXISTS 'EDGE_UNPINNED';

-- ============================================================
-- Helper: pin / unpin an edge (callable from application layer)
-- ============================================================

CREATE OR REPLACE FUNCTION pin_edge(p_edge_id UUID, p_user_id UUID, p_pinned BOOLEAN)
RETURNS VOID LANGUAGE sql AS $$
  UPDATE graph_edges
  SET is_pinned = p_pinned,
      updated_at = NOW()
  WHERE id = p_edge_id AND user_id = p_user_id;
$$;
