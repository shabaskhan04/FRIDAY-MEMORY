-- Migration 011: Autonomous Ingestion Engine
-- Tables: ingestion_sources, ingestion_runs, ingestion_events, ingestion_failures

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
