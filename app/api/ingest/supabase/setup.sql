-- ============================================================
-- COGNITIVE ROUTER — Run this in Supabase SQL Editor
-- Project → SQL Editor → New Query → Paste → Run
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- raw_ledgers: immutable ground-truth log
CREATE TABLE IF NOT EXISTS public.raw_ledgers (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL    DEFAULT now(),
  content    TEXT        NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_raw_ledgers_created_at
  ON public.raw_ledgers (created_at DESC);

-- temporal_memories: parsed temporal events
CREATE TABLE IF NOT EXISTS public.temporal_memories (
  id             UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_ledger_id  UUID  NOT NULL REFERENCES public.raw_ledgers (id) ON DELETE CASCADE,
  time_horizon   TEXT  NOT NULL CHECK (time_horizon IN ('past', 'present', 'future')),
  estimated_date TEXT,
  era            TEXT,
  event_summary  TEXT
);

CREATE INDEX IF NOT EXISTS idx_temporal_memories_raw_ledger_id
  ON public.temporal_memories (raw_ledger_id);
CREATE INDEX IF NOT EXISTS idx_temporal_memories_time_horizon
  ON public.temporal_memories (time_horizon);

-- entity_ledger: named entities extracted from each entry
CREATE TABLE IF NOT EXISTS public.entity_ledger (
  id               UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_ledger_id    UUID  NOT NULL REFERENCES public.raw_ledgers (id) ON DELETE CASCADE,
  name             TEXT  NOT NULL,
  interaction_type TEXT,
  trust_signal     TEXT  NOT NULL CHECK (trust_signal IN ('positive', 'negative', 'neutral')),
  ledger_note      TEXT
);

CREATE INDEX IF NOT EXISTS idx_entity_ledger_raw_ledger_id
  ON public.entity_ledger (raw_ledger_id);
CREATE INDEX IF NOT EXISTS idx_entity_ledger_trust_signal
  ON public.entity_ledger (trust_signal);
CREATE INDEX IF NOT EXISTS idx_entity_ledger_name
  ON public.entity_ledger (name);

-- ============================================================
-- RLS: For local dev, disable to avoid permission errors.
-- For production use service_role key in API routes instead.
-- ============================================================
ALTER TABLE public.raw_ledgers       DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.temporal_memories DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.entity_ledger     DISABLE ROW LEVEL SECURITY;
