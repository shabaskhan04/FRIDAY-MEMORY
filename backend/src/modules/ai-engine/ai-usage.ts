// ============================================================
// ai-usage.ts — AI usage logging + in-memory budget tracking
// Rule #10: every AI call logs to ai_usage_metrics
// ============================================================
import type { SupabaseClient } from '@supabase/supabase-js';

export type AIFeature =
  | 'ask_friday'
  | 'memory_extraction'
  | 'observation_classification'
  | 'weekly_review'
  | 'strategic_review'
  | 'confidence_reassessment'
  | 'batch_extraction'
  | 'ingestion_normalization'
  | 'twin_model_generation'
  | 'causal_pattern_inference'
  | 'activity_clustering'
  | 'daily_reflection'
  | 'health_analysis';

export type AIProvider = 'groq' | 'openai';
export type AIModel    = 'llama-3.1-8b-instant' | 'llama-3.3-70b-versatile' | 'text-embedding-3-small';

// Cost per 1M tokens (USD) — Groq free tier = $0; OpenAI embedding = $0.02/1M
const COST_PER_1M: Record<AIModel, number> = {
  'llama-3.1-8b-instant':    0,
  'llama-3.3-70b-versatile': 0,
  'text-embedding-3-small':  0.02,
};

export interface UsageRecord {
  feature:        AIFeature;
  provider:       AIProvider;
  model:          AIModel;
  tokens_in:      number;
  tokens_out:     number;
  estimated_cost: number;
  cached:         boolean;
  latency_ms:     number;
  timestamp:      string;
}

// In-memory daily budget state (resets at midnight UTC)
interface BudgetState {
  date:           string;   // YYYY-MM-DD
  calls:          Map<AIFeature, number>;
  tokens_in:      number;
  tokens_out:     number;
  embedding_calls: number;
}

let state: BudgetState = newState();

function newState(): BudgetState {
  return {
    date:            today(),
    calls:           new Map(),
    tokens_in:       0,
    tokens_out:      0,
    embedding_calls: 0,
  };
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function maybeReset(): void {
  if (state.date !== today()) state = newState();
}

// ---- Public API -------------------------------------------

export function recordUsageInMemory(record: UsageRecord): void {
  maybeReset();
  state.calls.set(record.feature, (state.calls.get(record.feature) ?? 0) + 1);
  state.tokens_in  += record.tokens_in;
  state.tokens_out += record.tokens_out;
  if (record.model === 'text-embedding-3-small') state.embedding_calls++;
}

export function getDailyCallCount(feature: AIFeature): number {
  maybeReset();
  return state.calls.get(feature) ?? 0;
}

export function getDailyTokensIn(): number  { maybeReset(); return state.tokens_in; }
export function getDailyEmbeddingCalls(): number { maybeReset(); return state.embedding_calls; }

export function estimateCost(model: AIModel, tokens_in: number, tokens_out: number): number {
  return ((tokens_in + tokens_out) / 1_000_000) * COST_PER_1M[model];
}

export async function logUsageToDb(db: SupabaseClient, userId: string, record: UsageRecord): Promise<void> {
  // Best-effort — never throw on logging failure
  try {
    await db.from('ai_usage_metrics').insert({
      user_id:        userId,
      feature:        record.feature,
      provider:       record.provider,
      model:          record.model,
      tokens_in:      record.tokens_in,
      tokens_out:     record.tokens_out,
      estimated_cost: record.estimated_cost,
      cached:         record.cached,
      latency_ms:     record.latency_ms,
    });
  } catch { /* silent */ }
}

/**
 * loadDailyCountsFromDb() — call once at startup to restore in-memory counters
 * from today's ai_usage_metrics rows so budget limits survive server restarts.
 */
export async function loadDailyCountsFromDb(db: SupabaseClient, userId: string): Promise<void> {
  try {
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const { data } = await db
      .from('ai_usage_metrics')
      .select('feature, tokens_in, tokens_out')
      .eq('user_id', userId)
      .gte('created_at', todayStart.toISOString());
    if (!data?.length) return;
    maybeReset();
    for (const row of data) {
      const f = row.feature as AIFeature;
      state.calls.set(f, (state.calls.get(f) ?? 0) + 1);
      state.tokens_in  += row.tokens_in  ?? 0;
      state.tokens_out += row.tokens_out ?? 0;
    }
  } catch { /* silent — counters remain at 0 on failure */ }
}
