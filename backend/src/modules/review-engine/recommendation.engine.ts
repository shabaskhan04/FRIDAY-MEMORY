// ============================================================
// recommendation.engine.ts — Evidence-based action recommendations
// No hallucinations. Every recommendation is derived from entity context.
// ============================================================
import type { EntityContext, Recommendation, RecommendationAction, EvidenceItem } from './review.types';
import type { FocusArea, DetectedRisk, PriorityScore } from './review.types';
import { computeFocusAndResult } from './review-scoring';

export class RecommendationEngine {

  /**
   * generateRecommendations() — derive one recommendation per entity.
   * Rules are deterministic: same input always produces same recommendation.
   */
  generateRecommendations(
    entities:    EntityContext[],
    focusAreas:  FocusArea[],
    risks:       DetectedRisk[],
    priorities:  PriorityScore[],
  ): Recommendation[] {
    const focusMap    = new Map(focusAreas.map(f => [f.entity.id, f]));
    const riskMap     = new Map<string, DetectedRisk[]>();
    const priorityMap = new Map(priorities.map(p => [p.entity.id, p]));

    for (const r of risks) {
      if (!riskMap.has(r.entity_id)) riskMap.set(r.entity_id, []);
      riskMap.get(r.entity_id)!.push(r);
    }

    return entities.map(entity => {
      const focus    = focusMap.get(entity.id);
      const entityRisks = riskMap.get(entity.id) ?? [];
      const priority = priorityMap.get(entity.id);

      const { action, reasoning, evidence } = this.decide(entity, focus, entityRisks, priority);
      return {
        entity_id:   entity.id,
        entity_name: entity.name,
        action,
        reasoning,
        evidence,
        confidence:  this.deriveConfidence(entity, entityRisks),
      };
    }).sort((a, b) => b.confidence - a.confidence);
  }

  // ---- Decision tree (explicit rules) ---------------------

  private decide(
    entity:   EntityContext,
    focus:    FocusArea | undefined,
    risks:    DetectedRisk[],
    priority: PriorityScore | undefined,
  ): { action: RecommendationAction; reasoning: string; evidence: EvidenceItem[] } {

    const verdict     = focus?.verdict;
    const highRisk    = risks.some(r => r.severity === 'CRITICAL' || r.severity === 'HIGH');
    const isGoal      = entity.node_type === 'GOAL';
    const isProject   = ['PROJECT', 'BUSINESS'].includes(entity.node_type);
    const stagnating  = risks.some(r => r.risk_type === 'PROJECT_STAGNATION');
    const failPattern = risks.some(r => r.risk_type === 'DECISION_FAILURE_PATTERN');
    const { focus_score, result_score } = computeFocusAndResult(entity);

    // ABANDON: stagnating + low goal alignment + repeated failures + sufficient history
    if (isProject && stagnating && failPattern && entity.goal_alignment_score < 0.25 && entity.mention_count >= 3) {
      return {
        action: 'ABANDON',
        reasoning: `${entity.name} is stagnating, has a poor decision track record, and does not align with current goals.`,
        evidence: this.evidenceItems(entity, focus_score, result_score),
      };
    }

    // FOCUS_MORE: high opportunity (goal aligned) but low attention
    if (entity.goal_alignment_score >= 0.65 && entity.attention_score < 0.35) {
      return {
        action: 'FOCUS_MORE',
        reasoning: `${entity.name} strongly supports your goals but is receiving insufficient attention.`,
        evidence: this.evidenceItems(entity, focus_score, result_score),
      };
    }

    // INVEST: high goal alignment + high causal influence + growing
    if (entity.goal_alignment_score >= 0.7 && entity.causal_influence_score >= 0.6 && entity.days_since_last_mention <= 14) {
      return {
        action: 'INVEST',
        reasoning: `${entity.name} has strong goal alignment and causal influence — increasing investment should compound returns.`,
        evidence: this.evidenceItems(entity, focus_score, result_score),
      };
    }

    // FOCUS_LESS: over-invested, under-performing
    if (verdict === 'HIGH_FOCUS_LOW_RESULT' && !isGoal) {
      return {
        action: 'FOCUS_LESS',
        reasoning: `${entity.name} is receiving high attention but producing limited results. Redirect effort elsewhere.`,
        evidence: this.evidenceItems(entity, focus_score, result_score),
      };
    }

    // REVIEW: neglected goal OR high risk
    if ((isGoal && entity.days_since_last_mention > 21) || highRisk) {
      return {
        action: 'REVIEW',
        reasoning: `${entity.name} requires a strategic review — ${isGoal ? 'it has been neglected' : 'risks have been detected'}.`,
        evidence: this.evidenceItems(entity, focus_score, result_score),
      };
    }

    // DELEGATE: important but low causal influence + active person connection
    if (entity.importance_score >= 0.6 && entity.causal_influence_score < 0.25 && entity.edge_count >= 3) {
      return {
        action: 'DELEGATE',
        reasoning: `${entity.name} is important but your direct causal influence is low — consider delegating.`,
        evidence: this.evidenceItems(entity, focus_score, result_score),
      };
    }

    // MAINTAIN: healthy and balanced
    return {
      action: 'MAINTAIN',
      reasoning: `${entity.name} is performing well and does not require immediate strategic change.`,
      evidence: this.evidenceItems(entity, focus_score, result_score),
    };
  }

  private evidenceItems(entity: EntityContext, focus: number, result: number): EvidenceItem[] {
    return [
      { factor: 'goal_alignment',    value: entity.goal_alignment_score,   weight: 0.30 },
      { factor: 'attention_score',   value: entity.attention_score,         weight: 0.20 },
      { factor: 'focus_score',       value: +focus.toFixed(3),              weight: 0.15 },
      { factor: 'result_score',      value: +result.toFixed(3),             weight: 0.15 },
      { factor: 'days_since_mention', value: entity.days_since_last_mention, weight: 0.10 },
      { factor: 'causal_influence',  value: entity.causal_influence_score,  weight: 0.10 },
    ];
  }

  private deriveConfidence(entity: EntityContext, risks: DetectedRisk[]): number {
    // More data points + consistent signals = higher confidence
    const dataDensity = Math.min(1, entity.mention_count / 10);
    const riskClarity = risks.length ? Math.max(...risks.map(r => r.confidence)) : 0.7;
    return Math.min(1, dataDensity * 0.4 + riskClarity * 0.6);
  }
}
