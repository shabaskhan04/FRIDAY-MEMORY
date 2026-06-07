// ============================================================
// decision.scoring.ts — Pure scoring functions, no I/O
// ============================================================
import type { Decision, DecisionEvaluation, DecisionScore } from './decision.types';

// ---- Individual scores ------------------------------------

/**
 * accuracy_score: how close expected was to actual.
 * Derived from the evaluation record directly.
 * If no evaluation yet, returns the expected_success_probability as a proxy.
 */
export function computeAccuracyScore(
  decision: Decision,
  evaluation: DecisionEvaluation | null,
): number {
  if (evaluation) return evaluation.accuracy_score;
  // No actual outcome yet — treat expected probability as proxy
  return decision.expected_success_probability;
}

/**
 * success_score: did the decision lead to a good outcome?
 * Weights: evaluation (primary) + status (secondary signal).
 */
export function computeSuccessScore(
  decision: Decision,
  evaluation: DecisionEvaluation | null,
): number {
  if (evaluation) return evaluation.success_score;
  // Derive from status when no eval
  const STATUS_SCORES: Record<string, number> = {
    COMPLETED: 0.8, ACTIVE: 0.5, PLANNED: 0.4, ABANDONED: 0.2, FAILED: 0.1,
  };
  return STATUS_SCORES[decision.status] ?? 0.4;
}

/**
 * impact_score: how many entities does this decision touch × avg node importance.
 * Caller provides the entity importance values (avoids repo dependency).
 */
export function computeImpactScore(entityImportanceScores: number[]): number {
  if (!entityImportanceScores.length) return 0;
  const avg = entityImportanceScores.reduce((s, v) => s + v, 0) / entityImportanceScores.length;
  const breadth = Math.min(1, entityImportanceScores.length / 10);
  return Math.min(1, avg * 0.6 + breadth * 0.4);
}

/**
 * composite_score:
 *   success    * 0.40
 *   accuracy   * 0.30
 *   impact     * 0.20
 *   confidence * 0.10
 */
export function computeCompositeScore(
  successScore: number,
  accuracyScore: number,
  impactScore: number,
  confidenceScore: number,
): number {
  return Math.min(1, Math.max(0,
    successScore    * 0.40 +
    accuracyScore   * 0.30 +
    impactScore     * 0.20 +
    confidenceScore * 0.10,
  ));
}

export function scoreDecision(
  decision: Decision,
  evaluation: DecisionEvaluation | null,
  entityImportanceScores: number[],
): DecisionScore {
  const success_score  = computeSuccessScore(decision, evaluation);
  const accuracy_score = computeAccuracyScore(decision, evaluation);
  const impact_score   = computeImpactScore(entityImportanceScores);
  const composite_score = computeCompositeScore(
    success_score, accuracy_score, impact_score, decision.confidence_score,
  );
  return { decision, success_score, accuracy_score, impact_score, composite_score };
}
