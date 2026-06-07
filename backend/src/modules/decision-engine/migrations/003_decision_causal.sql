-- ============================================================
-- Migration 003: Decision Intelligence + Causal Reasoning
-- ============================================================

-- ---- New relationship types in graph_edges ----------------
-- Extend the enum (Postgres requires separate ALTER statements)
ALTER TYPE relationship_type ADD VALUE IF NOT EXISTS 'DECIDES_ON';
ALTER TYPE relationship_type ADD VALUE IF NOT EXISTS 'AFFECTS';
ALTER TYPE relationship_type ADD VALUE IF NOT EXISTS 'SUPPORTS';
ALTER TYPE relationship_type ADD VALUE IF NOT EXISTS 'BLOCKS';
ALTER TYPE relationship_type ADD VALUE IF NOT EXISTS 'RESULTED_IN';
-- Causal
ALTER TYPE relationship_type ADD VALUE IF NOT EXISTS 'CAUSED';
ALTER TYPE relationship_type ADD VALUE IF NOT EXISTS 'CONTRIBUTED_TO';
ALTER TYPE relationship_type ADD VALUE IF NOT EXISTS 'ENABLED';
ALTER TYPE relationship_type ADD VALUE IF NOT EXISTS 'PREVENTED';
ALTER TYPE relationship_type ADD VALUE IF NOT EXISTS 'ACCELERATED';
ALTER TYPE relationship_type ADD VALUE IF NOT EXISTS 'DELAYED';

-- ---- Causal columns on graph_edges -----------------------
ALTER TABLE graph_edges
  ADD COLUMN IF NOT EXISTS causal_strength   FLOAT
    CHECK (causal_strength IS NULL OR causal_strength BETWEEN 0 AND 1),
  ADD COLUMN IF NOT EXISTS causal_evidence   JSONB DEFAULT '[]';

-- ---- Decisions -------------------------------------------

CREATE TYPE decision_status AS ENUM (
  'PLANNED', 'ACTIVE', 'COMPLETED', 'ABANDONED', 'FAILED'
);

CREATE TABLE decisions (
  id                          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id                     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title                       TEXT        NOT NULL,
  description                 TEXT,
  decision_type               TEXT        NOT NULL DEFAULT 'GENERAL',
  reasoning                   TEXT,
  expected_outcome            TEXT,
  expected_success_probability FLOAT      DEFAULT 0.5 CHECK (expected_success_probability BETWEEN 0 AND 1),
  actual_outcome              TEXT,
  status                      decision_status NOT NULL DEFAULT 'PLANNED',
  confidence_score            FLOAT       DEFAULT 0.5 CHECK (confidence_score BETWEEN 0 AND 1),
  decision_date               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  review_date                 TIMESTAMPTZ,
  created_at                  TIMESTAMPTZ DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER trg_decisions_updated_at
  BEFORE UPDATE ON decisions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX idx_decisions_user        ON decisions(user_id);
CREATE INDEX idx_decisions_status      ON decisions(user_id, status);
CREATE INDEX idx_decisions_type        ON decisions(user_id, decision_type);
CREATE INDEX idx_decisions_date        ON decisions(user_id, decision_date DESC);

-- ---- Decision ↔ Graph node join --------------------------

CREATE TABLE decision_entities (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  decision_id      UUID NOT NULL REFERENCES decisions(id) ON DELETE CASCADE,
  node_id          UUID NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
  relationship_type TEXT NOT NULL DEFAULT 'DECIDES_ON',
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_decision_entity UNIQUE (decision_id, node_id, relationship_type)
);

CREATE INDEX idx_de_decision ON decision_entities(decision_id);
CREATE INDEX idx_de_node     ON decision_entities(node_id);

-- ---- Decision evaluations --------------------------------

CREATE TABLE decision_evaluations (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  decision_id       UUID NOT NULL REFERENCES decisions(id) ON DELETE CASCADE,
  success_score     FLOAT NOT NULL CHECK (success_score BETWEEN 0 AND 1),
  accuracy_score    FLOAT NOT NULL CHECK (accuracy_score BETWEEN 0 AND 1),
  lessons           TEXT[],
  notes             TEXT,
  evaluated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_evals_decision ON decision_evaluations(decision_id);
