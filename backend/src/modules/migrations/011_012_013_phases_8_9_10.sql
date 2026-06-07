-- ============================================================
-- FRIDAY Phase 8-10 Combined Migration
-- Run this once in Supabase SQL Editor
-- ============================================================

-- ── 011: Autonomous Ingestion Engine ────────────────────────

create table if not exists ingestion_sources (
  id                   uuid primary key default gen_random_uuid(),
  user_id              text not null,
  source_type          text not null,
  name                 text not null,
  config               jsonb not null default '{}',
  enabled              boolean not null default true,
  last_sync_at         timestamptz,
  sync_status          text not null default 'IDLE',
  health_score         float not null default 1.0,
  consecutive_failures int not null default 0,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create table if not exists ingestion_runs (
  id               uuid primary key default gen_random_uuid(),
  source_id        uuid not null references ingestion_sources(id) on delete cascade,
  user_id          text not null,
  started_at       timestamptz not null default now(),
  completed_at     timestamptz,
  status           text not null default 'RUNNING',
  records_fetched  int not null default 0,
  records_ingested int not null default 0,
  records_skipped  int not null default 0,
  records_failed   int not null default 0,
  error_message    text
);

create table if not exists ingestion_events (
  id                 uuid primary key default gen_random_uuid(),
  run_id             uuid not null references ingestion_runs(id) on delete cascade,
  source_id          uuid not null references ingestion_sources(id) on delete cascade,
  user_id            text not null,
  external_id        text,
  content_hash       text not null,
  raw_content        text not null,
  normalized_content jsonb not null default '{}',
  source_type        text not null,
  status             text not null default 'PENDING',
  error_message      text,
  created_at         timestamptz not null default now()
);

create index if not exists idx_ingestion_events_dedup
  on ingestion_events(user_id, content_hash);
create index if not exists idx_ingestion_events_external
  on ingestion_events(user_id, external_id) where external_id is not null;

create table if not exists ingestion_failures (
  id             uuid primary key default gen_random_uuid(),
  source_id      uuid not null references ingestion_sources(id) on delete cascade,
  run_id         uuid references ingestion_runs(id) on delete set null,
  user_id        text not null,
  error_message  text not null,
  error_code     text,
  retry_count    int not null default 0,
  max_retries    int not null default 3,
  next_retry_at  timestamptz,
  is_dead_letter boolean not null default false,
  created_at     timestamptz not null default now()
);

create index if not exists idx_ingestion_failures_retry
  on ingestion_failures(user_id, next_retry_at) where is_dead_letter = false;

-- ── 012: Digital Twin Engine ─────────────────────────────────

create table if not exists digital_twin_profiles (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  text not null,
  display_name             text,
  summary                  text,
  top_goals                text[] not null default '{}',
  top_projects             text[] not null default '{}',
  top_people               text[] not null default '{}',
  work_hours_pattern       jsonb not null default '{}',
  productivity_peak        text,
  avg_decision_confidence  float not null default 0.5,
  risk_profile             text not null default 'MODERATE',
  last_rebuilt_at          timestamptz,
  version                  int not null default 1,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index if not exists idx_twin_profiles_user on digital_twin_profiles(user_id);

create table if not exists digital_twin_traits (
  id             uuid primary key default gen_random_uuid(),
  user_id        text not null,
  profile_id     uuid not null references digital_twin_profiles(id) on delete cascade,
  category       text not null,
  trait_name     text not null,
  trait_value    text not null,
  confidence     float not null default 0.5,
  evidence_count int not null default 1,
  source_types   text[] not null default '{}',
  first_seen_at  timestamptz not null default now(),
  last_seen_at   timestamptz not null default now(),
  unique(user_id, category, trait_name)
);

create table if not exists digital_twin_predictions (
  id                    uuid primary key default gen_random_uuid(),
  user_id               text not null,
  profile_id            uuid not null references digital_twin_profiles(id) on delete cascade,
  prediction_type       text not null,
  prediction            text not null,
  confidence            float not null,
  evidence              jsonb not null default '[]',
  supporting_node_ids   text[] not null default '{}',
  supporting_memory_ids text[] not null default '{}',
  created_at            timestamptz not null default now(),
  expires_at            timestamptz
);

create index if not exists idx_twin_predictions_user
  on digital_twin_predictions(user_id, created_at desc);

-- ── 013: Advanced Causal Reasoning Engine ────────────────────

create table if not exists causal_patterns (
  id               uuid primary key default gen_random_uuid(),
  user_id          text not null,
  pattern_type     text not null,
  cause_node_id    uuid references graph_nodes(id) on delete set null,
  cause_label      text not null,
  effect_node_id   uuid references graph_nodes(id) on delete set null,
  effect_label     text not null,
  description      text not null,
  occurrence_count int not null default 1,
  confidence       float not null default 0.3,
  status           text not null default 'CANDIDATE',
  first_seen_at    timestamptz not null default now(),
  last_seen_at     timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  unique(user_id, cause_label, effect_label, pattern_type)
);

create index if not exists idx_causal_patterns_user
  on causal_patterns(user_id, confidence desc);

create table if not exists causal_evidence (
  id          uuid primary key default gen_random_uuid(),
  pattern_id  uuid not null references causal_patterns(id) on delete cascade,
  user_id     text not null,
  description text not null,
  source_type text not null,
  source_id   text,
  weight      float not null default 0.5,
  observed_at timestamptz not null default now(),
  created_at  timestamptz not null default now()
);

create index if not exists idx_causal_evidence_pattern
  on causal_evidence(pattern_id, observed_at desc);

create table if not exists causal_predictions (
  id                   uuid primary key default gen_random_uuid(),
  user_id              text not null,
  pattern_id           uuid references causal_patterns(id) on delete set null,
  input_condition      text not null,
  predicted_outcome    text not null,
  confidence           float not null,
  supporting_patterns  text[] not null default '{}',
  created_at           timestamptz not null default now(),
  expires_at           timestamptz
);

create index if not exists idx_causal_predictions_user
  on causal_predictions(user_id, created_at desc);
