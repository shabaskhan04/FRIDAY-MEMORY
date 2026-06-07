// ============================================================
// decision.insights.ts — Pattern analytics, no I/O beyond repo
// ============================================================
import type { DecisionRepository } from './decision.repository';
import type {
  Decision, DecisionScore, DecisionPattern, RecurringMistake,
} from './decision.types';
import { scoreDecision } from './decision.scoring';

export class DecisionInsights {
  constructor(private readonly repo: DecisionRepository) {}

  // ---- Ranked lists ----------------------------------------

  async getBestDecisions(userId: string, limit = 10): Promise<DecisionScore[]> {
    return (await this.rankAll(userId)).slice(0, limit);
  }

  async getWorstDecisions(userId: string, limit = 10): Promise<DecisionScore[]> {
    return (await this.rankAll(userId)).reverse().slice(0, limit);
  }

  async getHighestImpactDecisions(userId: string, limit = 10): Promise<DecisionScore[]> {
    const ranked = await this.rankAll(userId);
    return ranked.sort((a, b) => b.impact_score - a.impact_score).slice(0, limit);
  }

  // ---- Pattern analysis ------------------------------------

  /**
   * getDecisionPatterns() — group decisions by decision_type.
   * Returns avg success/accuracy per type.
   * Answers: "What type of decisions do I make most successfully?"
   */
  async getDecisionPatterns(userId: string): Promise<DecisionPattern[]> {
    const scored = await this.rankAll(userId);
    const byType = new Map<string, DecisionScore[]>();

    for (const s of scored) {
      const t = s.decision.decision_type;
      if (!byType.has(t)) byType.set(t, []);
      byType.get(t)!.push(s);
    }

    return Array.from(byType.entries()).map(([type, scores]) => ({
      pattern_type: type,
      count:        scores.length,
      avg_success:  avg(scores.map(s => s.success_score)),
      avg_accuracy: avg(scores.map(s => s.accuracy_score)),
      examples:     scores.slice(0, 3).map(s => s.decision.title),
    })).sort((a, b) => b.avg_success - a.avg_success);
  }

  /**
   * getMostSuccessfulDecisionTypes() — top decision types by avg success score.
   */
  async getMostSuccessfulDecisionTypes(userId: string): Promise<DecisionPattern[]> {
    return (await this.getDecisionPatterns(userId)).slice(0, 5);
  }

  /**
   * getRecurringMistakes() — decisions with FAILED/ABANDONED status that share
   * the same decision_type. If the same type fails ≥ 2 times, it's a pattern.
   */
  async getRecurringMistakes(userId: string): Promise<RecurringMistake[]> {
    const [failed, abandoned] = await Promise.all([
      this.repo.listFailed(userId),
      this.repo.listByUser(userId, { status: 'ABANDONED' }),
    ]);
    const all = [...failed, ...abandoned];

    const byType = new Map<string, Decision[]>();
    for (const d of all) {
      if (!byType.has(d.decision_type)) byType.set(d.decision_type, []);
      byType.get(d.decision_type)!.push(d);
    }

    return Array.from(byType.entries())
      .filter(([, ds]) => ds.length >= 2)
      .map(([type, ds]) => ({
        pattern:          type,
        count:            ds.length,
        decision_ids:     ds.map(d => d.id),
        avg_failure_score: avg(ds.map(d => 1 - d.confidence_score)),
      }))
      .sort((a, b) => b.count - a.count);
  }

  // ---- Private helpers -------------------------------------

  private async rankAll(userId: string): Promise<DecisionScore[]> {
    const decisions = await this.repo.listByUser(userId);
    const scored = await Promise.all(decisions.map(async (d) => {
      const eval_ = await this.repo.getLatestEvaluation(d.id);
      const entities = await this.repo.getDecisionEntities(d.id);
      // Use confidence_score as a proxy importance when we don't have node details
      const importanceScores = entities.map(() => d.confidence_score);
      return scoreDecision(d, eval_, importanceScores);
    }));
    return scored.sort((a, b) => b.composite_score - a.composite_score);
  }
}

function avg(values: number[]): number {
  return values.length ? values.reduce((s, v) => s + v, 0) / values.length : 0;
}
