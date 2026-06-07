-- ============================================================
-- FRIDAY: Full Data Reset
-- Run in Supabase SQL Editor (Dashboard → SQL Editor)
-- Deletes ALL user data. Schema, types, functions unchanged.
-- ============================================================

-- Disable RLS for this session so deletes bypass row policies
SET LOCAL row_security = off;

-- ── Phase 8-10 tables (children first) ───────────────────────
DELETE FROM causal_predictions;
DELETE FROM causal_evidence;
DELETE FROM causal_patterns;

DELETE FROM digital_twin_predictions;
DELETE FROM digital_twin_traits;
DELETE FROM digital_twin_profiles;

DELETE FROM ingestion_failures;
DELETE FROM ingestion_events;
DELETE FROM ingestion_runs;
DELETE FROM ingestion_sources;

-- ── AI engine ─────────────────────────────────────────────────
DELETE FROM ai_usage_metrics;
DELETE FROM ai_response_cache;
DELETE FROM ai_budget_config;

-- ── Integration / pipelines ───────────────────────────────────
DELETE FROM pipeline_stages;
DELETE FROM pipeline_runs;

-- ── Review engine ─────────────────────────────────────────────
DELETE FROM review_recommendations;
DELETE FROM strategic_reviews;

-- ── Activity engine ───────────────────────────────────────────
DELETE FROM activity_observations;
DELETE FROM activities;

-- ── Observations ──────────────────────────────────────────────
DELETE FROM observations;

-- ── Decision engine ───────────────────────────────────────────
DELETE FROM decision_evaluations;
DELETE FROM decision_entities;
DELETE FROM decisions;

-- ── Knowledge graph ───────────────────────────────────────────
DELETE FROM graph_events;
DELETE FROM graph_snapshots;
DELETE FROM graph_canonical_entities;
DELETE FROM graph_edges;
DELETE FROM graph_nodes;

-- ── Core memory tables (legacy ingest pipeline) ───────────────
DELETE FROM todo_tasks;
DELETE FROM entity_ledger;
DELETE FROM temporal_memories;
DELETE FROM ledger_embeddings;
DELETE FROM raw_ledgers;

-- ── Health logs ───────────────────────────────────────────────
DELETE FROM health_logs;

-- ── Commands ──────────────────────────────────────────────────
DELETE FROM pending_commands;

-- ── Google OAuth tokens ───────────────────────────────────────
DELETE FROM google_tokens;

-- Done. All data removed. App is fully functional.
