// ============================================================
// review-scoring.ts — Explainable scoring primitives
// All functions are pure. Every score exposes contributing factors.
// ============================================================
import type { EntityContext, PriorityScore } from './review.types';

// ---- Priority score -------------------------------------

/**
 * calculatePriorityScore()
 *
 * priority = goal_alignment   * 0.30
 *           + attention        * 0.20
 *           + decision_impact  * 0.20
 *           + causal_influence * 0.20
 *           + growth_trend     * 0.10
 *
 * growth_trend = recency proxy: 1 − (days_since / 90), floored at 0
 */
export function calculatePriorityScore(entity: EntityContext): PriorityScore['factors'] & { priority_score: number } {
  const goal_alignment   = entity.goal_alignment_score ?? 0;
  const attention        = entity.attention_score ?? 0;
  const decision_impact  = entity.decision_success_rate ?? 0;
  const causal_influence = entity.causal_influence_score ?? 0;
  const growth_trend     = Math.max(0, 1 - (entity.days_since_last_mention ?? 0) / 90);

  const priority_score = Math.min(1, Math.max(0,
    goal_alignment   * 0.30 +
    attention        * 0.20 +
    decision_impact  * 0.20 +
    causal_influence * 0.20 +
    growth_trend     * 0.10,
  ));

  return { goal_alignment, attention, decision_impact, causal_influence, growth_trend, priority_score };
}

// ---- Focus / result mismatch ----------------------------

/**
 * focus_score: how much attention is being paid (attention + mention frequency proxy)
 * result_score: what is being produced (importance × goal_alignment × edge connectivity)
 */
export function computeFocusAndResult(entity: EntityContext): { focus_score: number; result_score: number } {
  const mention_norm = Math.log1p(Math.min(entity.mention_count ?? 0, 100)) / Math.log1p(100);
  const focus_score  = Math.min(1, (entity.attention_score ?? 0) * 0.6 + mention_norm * 0.4);

  const connectivity = Math.min(1, (entity.edge_count ?? 0) / 20);
  const result_score = Math.min(1,
    entity.importance_score         * 0.40 +
    entity.goal_alignment_score     * 0.35 +
    connectivity                    * 0.25,
  );

  return { focus_score, result_score };
}

// ---- Risk score ------------------------------------------

/**
 * stagnationRisk: entity hasn't been mentioned + has no recent edge activity
 * Range 0–1. High when days_since > 30 and edge_count is low.
 */
export function stagnationRisk(entity: EntityContext): number {
  const staleness = Math.min(1, entity.days_since_last_mention / 60);
  const isolation = Math.max(0, 1 - entity.edge_count / 10);
  return Math.min(1, staleness * 0.6 + isolation * 0.4);
}

/**
 * concentrationRisk: are too many entities depending on one node?
 * Proxy: if one entity has > 40% of total edge_count across all entities.
 */
export function concentrationRisk(entity: EntityContext, totalEdges: number): number {
  if (totalEdges === 0) return 0;
  const share = entity.edge_count / totalEdges;
  return share > 0.4 ? Math.min(1, (share - 0.4) / 0.4) : 0;
}

// ---- Overall strategic health ---------------------------

/**
 * overallScore() — single 0–1 health score for the strategic review.
 * avg priority of top-5 entities × avg goal alignment × (1 - avg risk)
 */
export function overallScore(
  avgTopPriority: number,
  avgGoalAlignment: number,
  avgRisk: number,
): number {
  return Math.min(1, Math.max(0,
    avgTopPriority    * 0.40 +
    avgGoalAlignment  * 0.40 +
    (1 - avgRisk)     * 0.20,
  ));
}
