// ============================================================
// priority.engine.ts — Ranked priorities with contributing factors
// ============================================================
import type { EntityContext, PriorityScore } from './review.types';
import { calculatePriorityScore } from './review-scoring';

export class PriorityEngine {

  /**
   * calculatePriority() — rank all entities by strategic priority.
   * Returns full breakdown of each contributing factor.
   */
  calculatePriority(entities: EntityContext[]): PriorityScore[] {
    const scored = entities.map((entity, idx) => {
      const factors = calculatePriorityScore(entity);
      return {
        entity,
        priority_rank:  0,  // assigned after sorting
        priority_score: factors.priority_score,
        factors: {
          goal_alignment:   factors.goal_alignment,
          attention:        factors.attention,
          decision_impact:  factors.decision_impact,
          causal_influence: factors.causal_influence,
          growth_trend:     factors.growth_trend,
        },
      };
    });

    return scored
      .sort((a, b) => b.priority_score - a.priority_score)
      .map((s, i) => ({ ...s, priority_rank: i + 1 }));
  }

  /**
   * topPriorities() — top N by priority_score.
   */
  topPriorities(entities: EntityContext[], n = 5): PriorityScore[] {
    return this.calculatePriority(entities).slice(0, n);
  }

  /**
   * emergingProjects() — projects with rising growth trend + decent goal alignment.
   * Not yet top priority but trajectory is positive.
   */
  emergingProjects(entities: EntityContext[]): EntityContext[] {
    return entities
      .filter(e => ['PROJECT', 'BUSINESS'].includes(e.node_type))
      .filter(e => {
        const f = calculatePriorityScore(e);
        return f.growth_trend >= 0.6 && e.days_since_last_mention <= 14;
      })
      .sort((a, b) => b.goal_alignment_score - a.goal_alignment_score)
      .slice(0, 5);
  }

  /**
   * topOpportunities() — entities with high potential (goal alignment) but low current attention.
   * Answers: "What deserves more investment?"
   */
  topOpportunities(entities: EntityContext[]): EntityContext[] {
    return entities
      .filter(e => e.goal_alignment_score >= 0.6 && e.attention_score < 0.4)
      .sort((a, b) => b.goal_alignment_score - a.goal_alignment_score)
      .slice(0, 5);
  }
}
