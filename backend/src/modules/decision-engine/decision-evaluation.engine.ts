// ============================================================
// decision-evaluation.engine.ts — Compare expectation vs reality
// ============================================================
import type { DecisionRepository } from './decision.repository';
import type {
  Decision, DecisionEvaluation, EvaluateDecisionInput,
} from './decision.types';

export class DecisionEvaluationEngine {
  constructor(private readonly repo: DecisionRepository) {}

  /**
   * evaluate() — the primary entry point after a decision resolves.
   *
   * accuracy_score: how close the actual was to expected (text similarity is
   * approximated by caller providing a 0–1 score, or derived from status).
   *
   * success_score: 0–1 representing how well the decision worked out.
   *
   * Auto-derives accuracy from expected_success_probability when caller
   * provides a raw outcome_match (0–1).
   */
  async evaluate(
    decisionId: string,
    userId: string,
    input: EvaluateDecisionInput & { outcome_match?: number },
  ): Promise<DecisionEvaluation> {
    const decision = await this.repo.getById(decisionId, userId);
    if (!decision) throw new Error(`Decision ${decisionId} not found`);

    // Derive accuracy from expected probability vs outcome_match if not provided
    const accuracy_score = input.accuracy_score ?? this.deriveAccuracy(
      decision.expected_success_probability,
      input.outcome_match ?? input.success_score,
    );

    const eval_ = await this.repo.saveEvaluation(decisionId, {
      success_score:  input.success_score,
      accuracy_score,
      lessons:        input.lessons ?? [],
      notes:          input.notes,
    });

    // Update decision status + actual_outcome if provided
    const statusUpdate: Partial<Decision> = {};
    if (input.success_score >= 0.6)  statusUpdate.status = 'COMPLETED';
    else if (input.success_score <= 0.3) statusUpdate.status = 'FAILED';

    await this.repo.update(decisionId, userId, statusUpdate as any);
    return eval_;
  }

  /**
   * getHistory() — all evaluations for a decision, newest first.
   * Useful to track if a decision improved over time.
   */
  async getHistory(decisionId: string): Promise<DecisionEvaluation[]> {
    return this.repo.getEvaluations(decisionId);
  }

  /**
   * summarise() — average scores across all evaluations.
   * Example: "Launch Orin" averaged 0.72 success over 3 reviews.
   */
  async summarise(decisionId: string): Promise<{
    avg_success: number;
    avg_accuracy: number;
    all_lessons: string[];
    evaluation_count: number;
  }> {
    const evals = await this.repo.getEvaluations(decisionId);
    if (!evals.length) return { avg_success: 0, avg_accuracy: 0, all_lessons: [], evaluation_count: 0 };

    const avg_success  = evals.reduce((s, e) => s + e.success_score,  0) / evals.length;
    const avg_accuracy = evals.reduce((s, e) => s + e.accuracy_score, 0) / evals.length;
    const all_lessons  = [...new Set(evals.flatMap(e => e.lessons))];

    return { avg_success, avg_accuracy, all_lessons, evaluation_count: evals.length };
  }

  // ---- Private ------------------------------------------

  /**
   * Accuracy = 1 - |expected - actual|
   * Example: expected 0.9, actual 0.3 → accuracy = 1 - 0.6 = 0.4
   */
  private deriveAccuracy(expected: number, actual: number): number {
    return Math.max(0, 1 - Math.abs(expected - actual));
  }
}
