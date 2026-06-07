-- Migration 013: Advanced Causal Reasoning Engine

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
