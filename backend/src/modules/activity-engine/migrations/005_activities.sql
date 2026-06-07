-- ============================================================
-- Migration 005: Activity Engine
-- ============================================================

-- signal_quality_score on observations (additive column)
ALTER TABLE observations
  ADD COLUMN IF NOT EXISTS signal_quality_score FLOAT
    DEFAULT 0.5 CHECK (signal_quality_score BETWEEN 0 AND 1);

CREATE INDEX idx_obs_signal_quality
  ON observations(user_id, signal_quality_score DESC);

-- activities
CREATE TABLE activities (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title           TEXT        NOT NULL,
  category        TEXT        NOT NULL,        -- mirrors ObservationCategory
  started_at      TIMESTAMPTZ NOT NULL,
  ended_at        TIMESTAMPTZ NOT NULL,
  duration_mins   INT         GENERATED ALWAYS AS
                    (EXTRACT(EPOCH FROM (ended_at - started_at)) / 60)::INT STORED,
  importance_score FLOAT      DEFAULT 0.5 CHECK (importance_score BETWEEN 0 AND 1),
  confidence_score FLOAT      DEFAULT 0.8 CHECK (confidence_score BETWEEN 0 AND 1),
  signal_quality   FLOAT      DEFAULT 0.5 CHECK (signal_quality   BETWEEN 0 AND 1),
  related_entities TEXT[]     DEFAULT '{}',
  metadata        JSONB       DEFAULT '{}',
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER trg_activities_updated_at
  BEFORE UPDATE ON activities
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX idx_activities_user     ON activities(user_id);
CREATE INDEX idx_activities_time     ON activities(user_id, started_at DESC);
CREATE INDEX idx_activities_category ON activities(user_id, category);
CREATE INDEX idx_activities_entities ON activities USING GIN (related_entities);

-- join: which observations produced an activity
CREATE TABLE activity_observations (
  activity_id    UUID NOT NULL REFERENCES activities(id)    ON DELETE CASCADE,
  observation_id UUID NOT NULL REFERENCES observations(id)  ON DELETE CASCADE,
  PRIMARY KEY (activity_id, observation_id)
);

CREATE INDEX idx_ao_obs ON activity_observations(observation_id);
