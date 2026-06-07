// ============================================================
// ai-rate-limiter.ts — Per-feature budget enforcement
// Rule #9: hard stop when budget exceeded
// ============================================================
import type { AIFeature } from './ai-usage';
import { getDailyCallCount } from './ai-usage';

// Daily call limits per feature (Rule #9)
const DAILY_LIMITS: Record<AIFeature, number> = {
  ask_friday:                  500,
  memory_extraction:           200,
  batch_extraction:            50,
  observation_classification:  0,    // L0 — never uses AI (rule-based only)
  weekly_review:               1,    // 1/week enforced separately
  strategic_review:            7,    // up to 1/day
  confidence_reassessment:     100,
  ingestion_normalization:     500,
  twin_model_generation:       10,
  causal_pattern_inference:    50,
};

// Hard token budget per call (Rule #6)
export const TOKEN_BUDGET: Record<AIFeature, number> = {
  ask_friday:                  8_000,
  weekly_review:               10_000,
  strategic_review:            8_000,
  memory_extraction:           1_500,
  batch_extraction:            4_000,
  observation_classification:  500,
  confidence_reassessment:     1_500,
  ingestion_normalization:     2_000,
  twin_model_generation:       8_000,
  causal_pattern_inference:    4_000,
};

export class RateLimitError extends Error {
  constructor(feature: AIFeature, reason: string) {
    super(`[RateLimit] ${feature}: ${reason}`);
    this.name = 'RateLimitError';
  }
}

export function checkRateLimit(feature: AIFeature): void {
  const limit = DAILY_LIMITS[feature];
  if (limit === 0) {
    throw new RateLimitError(feature, 'this feature must not use AI — use deterministic logic');
  }
  const used = getDailyCallCount(feature);
  if (used >= limit) {
    throw new RateLimitError(feature, `daily limit of ${limit} reached (used: ${used})`);
  }
}

export function enforceTokenBudget(feature: AIFeature, promptTokens: number): void {
  const budget = TOKEN_BUDGET[feature];
  if (promptTokens > budget) {
    throw new RateLimitError(
      feature,
      `prompt too large: ${promptTokens} tokens > budget of ${budget}`,
    );
  }
}

// Rough token estimator — 1 token ≈ 4 chars
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
