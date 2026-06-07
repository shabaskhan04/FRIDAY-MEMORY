-- Migration 012: Digital Twin Engine

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

create index if not exists idx_twin_predictions_user on digital_twin_predictions(user_id, created_at desc);
