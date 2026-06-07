-- ============================================================
-- Migration 004: Observation Layer
-- ============================================================

CREATE TYPE observation_source AS ENUM (
  'MANUAL',
  'GIT_COMMIT', 'GIT_PR', 'GIT_BRANCH',
  'EMAIL_SENT', 'EMAIL_RECEIVED',
  'CALENDAR_EVENT',
  'TASK_CREATED', 'TASK_COMPLETED',
  'FILE_CREATED', 'FILE_MODIFIED', 'FILE_DELETED',
  'HEALTH_UPDATE',
  'APP_USAGE', 'WEBSITE_VISIT', 'DEVICE_ACTIVITY',
  'DOCUMENT_CREATED', 'DOCUMENT_UPDATED',
  'RESEARCH_SESSION', 'YOUTUBE_WATCH', 'BOOK_READING', 'COURSE_PROGRESS',
  'FINANCIAL_TRANSACTION', 'REVENUE_EVENT', 'EXPENSE_EVENT',
  'PROJECT_MILESTONE',
  'SOCIAL_INTERACTION', 'PHONE_CALL', 'MESSAGE_SENT', 'MESSAGE_RECEIVED',
  'CUSTOM'
);

CREATE TYPE observation_category AS ENUM (
  'WORK', 'HEALTH', 'LEARNING', 'SOCIAL',
  'FINANCE', 'PROJECT', 'PERSONAL', 'SYSTEM'
);

CREATE TABLE observations (
  id                UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id           UUID          NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source            observation_source NOT NULL,
  event_type        TEXT          NOT NULL,           -- finer-grained subtype (e.g. 'push', 'merged')
  title             TEXT          NOT NULL,
  description       TEXT,
  occurred_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  importance_score  FLOAT         DEFAULT 0.5 CHECK (importance_score BETWEEN 0 AND 1),
  confidence_score  FLOAT         DEFAULT 1.0 CHECK (confidence_score BETWEEN 0 AND 1),
  categories        observation_category[] DEFAULT '{}',
  metadata          JSONB         DEFAULT '{}',
  related_entities  TEXT[]        DEFAULT '{}',       -- entity names (resolved to graph nodes later)
  is_processed      BOOLEAN       DEFAULT FALSE,
  created_at        TIMESTAMPTZ   DEFAULT NOW(),
  updated_at        TIMESTAMPTZ   DEFAULT NOW()
);

CREATE TRIGGER trg_observations_updated_at
  BEFORE UPDATE ON observations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Lookup + filtering
CREATE INDEX idx_obs_user          ON observations(user_id);
CREATE INDEX idx_obs_source        ON observations(user_id, source);
CREATE INDEX idx_obs_occurred      ON observations(user_id, occurred_at DESC);
CREATE INDEX idx_obs_importance    ON observations(user_id, importance_score DESC);
CREATE INDEX idx_obs_unprocessed   ON observations(user_id, is_processed) WHERE is_processed = FALSE;
CREATE INDEX idx_obs_categories    ON observations USING GIN (categories);
CREATE INDEX idx_obs_entities      ON observations USING GIN (related_entities);
CREATE INDEX idx_obs_metadata      ON observations USING GIN (metadata);
