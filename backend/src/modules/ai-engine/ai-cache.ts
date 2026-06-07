// ============================================================
// ai-cache.ts — In-memory + DB response cache
// Rule #4: never regenerate identical prompts
// ============================================================
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AIFeature } from './ai-usage';
import { createHash } from 'crypto';

// TTLs in milliseconds
const TTL: Record<AIFeature, number> = {
  ask_friday:                  1000 * 60 * 60 * 6,
  weekly_review:               1000 * 60 * 60 * 24 * 7,
  strategic_review:            1000 * 60 * 60 * 24 * 7,
  memory_extraction:           1000 * 60 * 60 * 24,
  observation_classification:  1000 * 60 * 60 * 1,
  confidence_reassessment:     1000 * 60 * 60 * 24,
  batch_extraction:            1000 * 60 * 60 * 24,
  ingestion_normalization:     1000 * 60 * 60 * 6,
  twin_model_generation:       1000 * 60 * 60 * 24,
  causal_pattern_inference:    1000 * 60 * 60 * 6,
};

interface CacheEntry {
  value:      string;
  expires_at: number;
}

// In-memory L1 cache
const memCache = new Map<string, CacheEntry>();

export function hashPrompt(systemPrompt: string, userPrompt: string): string {
  return createHash('sha256')
    .update(systemPrompt + '\x00' + userPrompt)
    .digest('hex')
    .slice(0, 32);
}

// ---- L1: memory cache ------------------------------------

export function getFromMemCache(key: string): string | null {
  const entry = memCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expires_at) { memCache.delete(key); return null; }
  return entry.value;
}

export function setInMemCache(key: string, value: string, feature: AIFeature): void {
  // Evict oldest 10% when over 500 entries
  if (memCache.size >= 500) {
    const keys = [...memCache.keys()].slice(0, 50);
    keys.forEach(k => memCache.delete(k));
  }
  memCache.set(key, { value, expires_at: Date.now() + TTL[feature] });
}

// ---- L2: DB cache ----------------------------------------

export async function getFromDbCache(db: SupabaseClient, key: string): Promise<string | null> {
  try {
    const { data } = await db
      .from('ai_response_cache')
      .select('response')
      .eq('prompt_hash', key)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();
    return data?.response ?? null;
  } catch { return null; }
}

export async function setInDbCache(
  db: SupabaseClient,
  key: string,
  value: string,
  feature: AIFeature,
): Promise<void> {
  try {
    const expires_at = new Date(Date.now() + TTL[feature]).toISOString();
    await db.from('ai_response_cache').upsert(
      { prompt_hash: key, response: value, feature, expires_at },
      { onConflict: 'prompt_hash' },
    );
  } catch { /* silent */ }
}

// ---- Unified get (L1 → L2) --------------------------------

export async function getCached(
  db: SupabaseClient | null,
  key: string,
): Promise<string | null> {
  const mem = getFromMemCache(key);
  if (mem) return mem;
  if (!db) return null;
  return getFromDbCache(db, key);
}

// ---- Unified set (L1 + L2) --------------------------------

export async function setCached(
  db: SupabaseClient | null,
  key: string,
  value: string,
  feature: AIFeature,
): Promise<void> {
  setInMemCache(key, value, feature);
  if (db) await setInDbCache(db, key, value, feature);
}
