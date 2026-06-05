-- ============================================================
-- COGNITIVE ROUTER — Schema Upgrade v2
-- Run this in: Supabase → SQL Editor → New Query → Paste → Run
-- Safe to run multiple times (IF NOT EXISTS / IF NOT EXISTS guards)
-- ============================================================

-- ── 1. Upgrade raw_ledgers with ambient + intent columns ──────

ALTER TABLE public.raw_ledgers
  ADD COLUMN IF NOT EXISTS intent_tag    text DEFAULT 'standard'
    CHECK (intent_tag IN ('standard', 'spark', 'friction')),
  ADD COLUMN IF NOT EXISTS device_type   text,
  ADD COLUMN IF NOT EXISTS local_timezone text;

-- ── 2. Autonomous To-Do Generation Table ─────────────────────

CREATE TABLE IF NOT EXISTS public.todo_tasks (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_ledger_id  uuid        REFERENCES public.raw_ledgers(id) ON DELETE CASCADE,
  task_description text      NOT NULL,
  status         text        DEFAULT 'pending'
    CHECK (status IN ('pending', 'done')),
  created_at     timestamptz DEFAULT now()
);

-- Partial index: only pending rows — keeps the client fetch O(pending)
CREATE INDEX IF NOT EXISTS idx_todo_tasks_status
  ON public.todo_tasks(status)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_todo_tasks_raw_ledger_id
  ON public.todo_tasks(raw_ledger_id);

-- Disable RLS for dev (use service_role key in production)
ALTER TABLE public.todo_tasks DISABLE ROW LEVEL SECURITY;
