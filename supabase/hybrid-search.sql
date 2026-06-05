-- ============================================================
-- FRIDAY Hybrid Retrieval — Migration
-- Run AFTER setup.sql and semantic-search.sql
-- Supabase → SQL Editor → New Query → Paste → Run
-- ============================================================

-- ── 1. Full-text search on raw_ledgers ───────────────────────

ALTER TABLE public.raw_ledgers
  ADD COLUMN IF NOT EXISTS fts_vector tsvector
    GENERATED ALWAYS AS (
      to_tsvector('english', coalesce(content, ''))
    ) STORED;

CREATE INDEX IF NOT EXISTS idx_raw_ledgers_fts
  ON public.raw_ledgers USING GIN (fts_vector);

-- ── 2. Reflection columns ────────────────────────────────────

ALTER TABLE public.raw_ledgers
  ADD COLUMN IF NOT EXISTS is_reflection    boolean     DEFAULT false,
  ADD COLUMN IF NOT EXISTS reflection_type  text,
  ADD COLUMN IF NOT EXISTS source_memory_ids jsonb;

CREATE INDEX IF NOT EXISTS idx_raw_ledgers_is_reflection
  ON public.raw_ledgers (is_reflection)
  WHERE is_reflection = true;

-- ── 3. Keyword search RPC ────────────────────────────────────
-- Returns keyword-ranked memories using PostgreSQL full-text.
-- ts_rank result is normalized 0→1 relative to the max in the
-- result set in application code (not in SQL, to avoid a
-- second pass).

CREATE OR REPLACE FUNCTION public.match_memories_keyword(
  query_text   text,
  match_count  int  DEFAULT 20
)
RETURNS TABLE (
  id           uuid,
  raw_ledger_id uuid,
  content      text,
  created_at   timestamptz,
  intent_tag   text,
  local_timezone text,
  location_text text,
  keyword_score float
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    rl.id,
    rl.id          AS raw_ledger_id,
    rl.content,
    rl.created_at,
    rl.intent_tag,
    rl.local_timezone,
    rl.location_text,
    ts_rank(rl.fts_vector, websearch_to_tsquery('english', query_text), 32)::float AS keyword_score
  FROM public.raw_ledgers rl
  WHERE
    rl.fts_vector @@ websearch_to_tsquery('english', query_text)
    AND (rl.is_reflection IS NULL OR rl.is_reflection = false)
  ORDER BY keyword_score DESC
  LIMIT LEAST(GREATEST(match_count, 1), 50);
$$;

GRANT EXECUTE ON FUNCTION public.match_memories_keyword(text, int)
  TO anon, authenticated;

-- ── 4. Hybrid search RPC ─────────────────────────────────────
-- Merges semantic + keyword results and returns final_score.
-- Weights are passed from the application layer so they can
-- be adjusted per query type without redeploying SQL.

CREATE OR REPLACE FUNCTION public.match_memories_hybrid(
  query_embedding  vector(1536),
  query_text       text,
  semantic_weight  float  DEFAULT 0.5,
  keyword_weight   float  DEFAULT 0.25,
  recency_weight   float  DEFAULT 0.1,
  match_count      int    DEFAULT 10,
  match_threshold  float  DEFAULT -1
)
RETURNS TABLE (
  id              uuid,
  content         text,
  created_at      timestamptz,
  intent_tag      text,
  local_timezone  text,
  location_text   text,
  semantic_score  float,
  keyword_score   float,
  recency_score   float,
  final_score     float
)
LANGUAGE sql
STABLE
AS $$
  WITH semantic AS (
    SELECT
      rl.id,
      rl.content,
      rl.created_at,
      rl.intent_tag,
      rl.local_timezone,
      rl.location_text,
      (1 - (le.embedding <=> query_embedding))::float AS semantic_score
    FROM public.ledger_embeddings le
    JOIN public.raw_ledgers rl ON rl.id = le.raw_ledger_id
    WHERE
      (1 - (le.embedding <=> query_embedding)) >= match_threshold
      AND (rl.is_reflection IS NULL OR rl.is_reflection = false)
    ORDER BY le.embedding <=> query_embedding
    LIMIT 20
  ),
  keyword AS (
    SELECT
      rl.id,
      ts_rank(rl.fts_vector, websearch_to_tsquery('english', query_text), 32)::float AS kw_score
    FROM public.raw_ledgers rl
    WHERE
      rl.fts_vector @@ websearch_to_tsquery('english', query_text)
      AND (rl.is_reflection IS NULL OR rl.is_reflection = false)
    LIMIT 20
  ),
  -- Normalize keyword scores to 0-1 range
  kw_max AS (
    SELECT GREATEST(MAX(kw_score), 0.0001) AS max_kw FROM keyword
  ),
  merged AS (
    SELECT
      COALESCE(s.id, k.id)               AS id,
      COALESCE(s.content, rl2.content)    AS content,
      COALESCE(s.created_at, rl2.created_at) AS created_at,
      COALESCE(s.intent_tag, rl2.intent_tag) AS intent_tag,
      COALESCE(s.local_timezone, rl2.local_timezone) AS local_timezone,
      COALESCE(s.location_text, rl2.location_text)   AS location_text,
      COALESCE(s.semantic_score, 0.0)::float         AS semantic_score,
      COALESCE(k.kw_score / km.max_kw, 0.0)::float  AS keyword_score,
      -- Flat 2-tier recency: recent (<30 days) = 1.0, older = 0.9.
      -- No memory ever decays below 0.9 — ensures lifelong accessibility.
      CASE
        WHEN EXTRACT(EPOCH FROM (NOW() - COALESCE(s.created_at, rl2.created_at))) < 2592000.0
        THEN 1.0
        ELSE 0.9
      END::float AS recency_score
    FROM semantic s
    FULL OUTER JOIN keyword k ON k.id = s.id
    LEFT JOIN public.raw_ledgers rl2 ON rl2.id = k.id AND s.id IS NULL
    CROSS JOIN kw_max km
  )
  SELECT
    m.id,
    m.content,
    m.created_at,
    m.intent_tag,
    m.local_timezone,
    m.location_text,
    m.semantic_score,
    m.keyword_score,
    m.recency_score,
    (
      m.semantic_score * semantic_weight +
      m.keyword_score  * keyword_weight  +
      m.recency_score  * recency_weight
      -- entity_score applied in application layer after entity detection
    )::float AS final_score
  FROM merged m
  ORDER BY final_score DESC
  LIMIT LEAST(GREATEST(match_count, 1), 50);
$$;

GRANT EXECUTE ON FUNCTION public.match_memories_hybrid(vector(1536), text, float, float, float, int, float)
  TO anon, authenticated;

-- ── 5. Reflections insert helper ─────────────────────────────

CREATE OR REPLACE FUNCTION public.insert_reflection(
  p_content          text,
  p_embedding        vector(1536),
  p_reflection_type  text,
  p_source_ids       jsonb
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_ledger_id uuid;
BEGIN
  INSERT INTO public.raw_ledgers (content, is_reflection, reflection_type, source_memory_ids)
  VALUES (p_content, true, p_reflection_type, p_source_ids)
  RETURNING id INTO v_ledger_id;

  INSERT INTO public.ledger_embeddings (raw_ledger_id, embedding)
  VALUES (v_ledger_id, p_embedding);

  RETURN v_ledger_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.insert_reflection(text, vector(1536), text, jsonb)
  TO anon, authenticated;
