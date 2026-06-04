-- ============================================================
-- FRIDAY Health Metrics Schema
-- Run in: Supabase → SQL Editor → New Query → Paste → Run
-- ============================================================

CREATE TABLE IF NOT EXISTS public.health_logs (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  log_date     date        NOT NULL DEFAULT CURRENT_DATE,
  metric_type  text        NOT NULL
    CHECK (metric_type IN ('sleep', 'steps', 'body')),
  -- sleep fields
  sleep_hours  numeric(4,2),
  sleep_quality text CHECK (sleep_quality IN ('poor','fair','good','great')),
  -- steps
  steps        integer,
  -- body (weekly)
  weight_kg    numeric(5,2),
  height_cm    numeric(5,2),
  -- notes
  notes        text,
  created_at   timestamptz DEFAULT now(),
  UNIQUE (log_date, metric_type)
);

CREATE INDEX IF NOT EXISTS idx_health_logs_date      ON public.health_logs(log_date DESC);
CREATE INDEX IF NOT EXISTS idx_health_logs_type      ON public.health_logs(metric_type);

ALTER TABLE public.health_logs DISABLE ROW LEVEL SECURITY;
