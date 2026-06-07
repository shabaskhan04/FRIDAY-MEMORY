-- ============================================================
-- Migration 007: Integration Layer
-- ============================================================

CREATE TYPE pipeline_status AS ENUM ('PENDING','RUNNING','COMPLETED','FAILED','SKIPPED');
CREATE TYPE workflow_type    AS ENUM (
  'OBSERVATION_INGESTION',
  'DECISION_EVALUATION',
  'WEEKLY_REVIEW',
  'GRAPH_UPDATE',
  'MANUAL'
);

CREATE TABLE pipeline_runs (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workflow_type  workflow_type   NOT NULL,
  status         pipeline_status NOT NULL DEFAULT 'PENDING',
  started_at     TIMESTAMPTZ     DEFAULT NOW(),
  completed_at   TIMESTAMPTZ,
  duration_ms    INT GENERATED ALWAYS AS
                   (EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000)::INT STORED,
  metadata       JSONB DEFAULT '{}'
);

CREATE INDEX idx_runs_user         ON pipeline_runs(user_id, started_at DESC);
CREATE INDEX idx_runs_status       ON pipeline_runs(user_id, status);
CREATE INDEX idx_runs_workflow     ON pipeline_runs(user_id, workflow_type);

CREATE TABLE pipeline_stages (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pipeline_run_id UUID NOT NULL REFERENCES pipeline_runs(id) ON DELETE CASCADE,
  stage_name      TEXT            NOT NULL,
  status          pipeline_status NOT NULL DEFAULT 'PENDING',
  started_at      TIMESTAMPTZ     DEFAULT NOW(),
  completed_at    TIMESTAMPTZ,
  duration_ms     INT,
  error           TEXT,
  metadata        JSONB DEFAULT '{}'
);

CREATE INDEX idx_stages_run    ON pipeline_stages(pipeline_run_id);
CREATE INDEX idx_stages_status ON pipeline_stages(pipeline_run_id, status);
