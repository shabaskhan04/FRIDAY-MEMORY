-- ============================================================
-- Migration 006: Strategic Review Engine
-- ============================================================

CREATE TABLE strategic_reviews (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  period_start    TIMESTAMPTZ NOT NULL,
  period_end      TIMESTAMPTZ NOT NULL,
  trigger         TEXT        NOT NULL DEFAULT 'manual',  -- 'manual' | 'weekly' | 'monthly'
  summary         JSONB       NOT NULL DEFAULT '{}',      -- full StrategicReview payload
  overall_score   FLOAT       CHECK (overall_score BETWEEN 0 AND 1),
  confidence      FLOAT       CHECK (confidence    BETWEEN 0 AND 1),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_reviews_user ON strategic_reviews(user_id, created_at DESC);

CREATE TABLE review_recommendations (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  review_id      UUID NOT NULL REFERENCES strategic_reviews(id) ON DELETE CASCADE,
  entity_id      TEXT,          -- graph node id or name
  entity_name    TEXT NOT NULL,
  action         TEXT NOT NULL, -- RecommendationAction enum value
  reasoning      TEXT NOT NULL,
  confidence     FLOAT NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  evidence       JSONB DEFAULT '[]',
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_recs_review  ON review_recommendations(review_id);
CREATE INDEX idx_recs_entity  ON review_recommendations(entity_name);
