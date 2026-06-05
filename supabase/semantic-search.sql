-- ============================================================
-- FRIDAY semantic memory search
-- Run this in Supabase SQL Editor if match_memories does not exist.
-- Uses OpenAI text-embedding-3-small compatible vectors: 1536 dims.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS public.ledger_embeddings (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_ledger_id uuid NOT NULL REFERENCES public.raw_ledgers(id) ON DELETE CASCADE,
  embedding     vector(1536) NOT NULL,
  created_at    timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ledger_embeddings_raw_ledger_id
  ON public.ledger_embeddings(raw_ledger_id);

CREATE OR REPLACE FUNCTION public.match_memories(
  query_embedding vector(1536),
  match_count int DEFAULT 20,
  match_threshold float DEFAULT -1
)
RETURNS TABLE (
  id uuid,
  raw_ledger_id uuid,
  content text,
  created_at timestamptz,
  intent_tag text,
  local_timezone text,
  location_text text,
  similarity float
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    rl.id,
    le.raw_ledger_id,
    rl.content,
    rl.created_at,
    rl.intent_tag,
    rl.local_timezone,
    rl.location_text,
    1 - (le.embedding <=> query_embedding) AS similarity
  FROM public.ledger_embeddings le
  JOIN public.raw_ledgers rl
    ON rl.id = le.raw_ledger_id
  WHERE 1 - (le.embedding <=> query_embedding) >= match_threshold
  ORDER BY le.embedding <=> query_embedding
  LIMIT LEAST(GREATEST(match_count, 1), 50);
$$;

GRANT EXECUTE ON FUNCTION public.match_memories(vector(1536), int, float)
  TO anon, authenticated;
