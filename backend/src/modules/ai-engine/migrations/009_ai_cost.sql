-- ============================================================
-- Migration 009: AI Cost Infrastructure
-- ai_usage_metrics, ai_response_cache, ai_budget_config
-- ============================================================

-- ---- AI usage tracking (Rule #10) ------------------------

CREATE TABLE ai_usage_metrics (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  feature         TEXT        NOT NULL,
  provider        TEXT        NOT NULL,
  model           TEXT        NOT NULL,
  tokens_in       INT         NOT NULL DEFAULT 0,
  tokens_out      INT         NOT NULL DEFAULT 0,
  estimated_cost  FLOAT       NOT NULL DEFAULT 0,
  cached          BOOLEAN     NOT NULL DEFAULT FALSE,
  latency_ms      INT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_usage_user_date ON ai_usage_metrics(user_id, created_at DESC);
CREATE INDEX idx_usage_feature   ON ai_usage_metrics(user_id, feature, created_at DESC);

-- Daily cost summary view
CREATE OR REPLACE VIEW ai_daily_cost AS
  SELECT
    user_id,
    DATE(created_at) AS day,
    feature,
    COUNT(*)                              AS calls,
    SUM(tokens_in)                        AS total_tokens_in,
    SUM(tokens_out)                       AS total_tokens_out,
    SUM(estimated_cost)                   AS total_cost,
    ROUND(AVG(latency_ms)::NUMERIC, 0)    AS avg_latency_ms,
    SUM(CASE WHEN cached THEN 1 ELSE 0 END) AS cache_hits
  FROM ai_usage_metrics
  GROUP BY user_id, DATE(created_at), feature;

-- ---- AI response cache (Rule #4) -------------------------

CREATE TABLE ai_response_cache (
  prompt_hash  TEXT        PRIMARY KEY,
  response     TEXT        NOT NULL,
  feature      TEXT        NOT NULL,
  expires_at   TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_cache_feature    ON ai_response_cache(feature);
CREATE INDEX idx_cache_expires    ON ai_response_cache(expires_at);

-- Cleanup expired cache entries (run via pg_cron daily)
-- SELECT cron.schedule('clean-ai-cache', '0 3 * * *',
--   $$DELETE FROM ai_response_cache WHERE expires_at < NOW()$$);

-- ---- Per-user budget config (Rule #9) --------------------

CREATE TABLE ai_budget_config (
  user_id            UUID    PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  daily_call_limit   INT     NOT NULL DEFAULT 500,
  monthly_usd_limit  FLOAT   NOT NULL DEFAULT 5.0,   -- OpenAI embedding budget
  embedding_daily_limit INT  NOT NULL DEFAULT 500,
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);

-- RLS
ALTER TABLE ai_usage_metrics   ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_response_cache  ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_budget_config   ENABLE ROW LEVEL SECURITY;

CREATE POLICY ai_usage_user_only   ON ai_usage_metrics  USING (user_id = auth.uid());
CREATE POLICY ai_budget_user_only  ON ai_budget_config  USING (user_id = auth.uid());
-- Cache is shared (no user_id — prompt hash is anonymous)
CREATE POLICY ai_cache_read_all    ON ai_response_cache FOR SELECT USING (TRUE);
CREATE POLICY ai_cache_write_all   ON ai_response_cache FOR ALL   USING (TRUE);
