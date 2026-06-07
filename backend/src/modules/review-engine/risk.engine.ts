// ============================================================
// risk.engine.ts — Detect strategic risks from entity context
// Pure analysis. No I/O.
// ============================================================
import type { EntityContext, DetectedRisk, RiskType } from './review.types';
import { stagnationRisk, concentrationRisk } from './review-scoring';

const SEVERITY = (score: number): DetectedRisk['severity'] =>
  score >= 0.8 ? 'CRITICAL' : score >= 0.6 ? 'HIGH' : score >= 0.4 ? 'MEDIUM' : 'LOW';

export class RiskEngine {

  detectRisks(entities: EntityContext[]): DetectedRisk[] {
    const totalEdges = entities.reduce((s, e) => s + e.edge_count, 0);
    const risks: DetectedRisk[] = [];

    for (const entity of entities) {
      risks.push(...this.entityRisks(entity, totalEdges, entities));
    }

    // Portfolio-level risks
    risks.push(...this.concentrationRisks(entities, totalEdges));

    return risks
      .filter(r => r.risk_score >= 0.3)
      .sort((a, b) => b.risk_score - a.risk_score);
  }

  // ---- Per-entity detectors --------------------------------

  private entityRisks(
    entity: EntityContext,
    totalEdges: number,
    all: EntityContext[],
  ): DetectedRisk[] {
    const risks: DetectedRisk[] = [];

    // 1. Project stagnation
    if (['PROJECT', 'BUSINESS'].includes(entity.node_type)) {
      const score = stagnationRisk(entity);
      if (score >= 0.3) {
        risks.push({
          risk_type:   'PROJECT_STAGNATION',
          entity_name: entity.name,
          entity_id:   entity.id,
          risk_score:  score,
          severity:    SEVERITY(score),
          confidence:  0.85,
          description: `${entity.name} has had no recent activity.`,
          evidence: [
            `Last mentioned ${Math.round(entity.days_since_last_mention)} days ago`,
            `Only ${entity.edge_count} active connections`,
          ],
        });
      }
    }

    // 2. Goal neglect
    if (entity.node_type === 'GOAL') {
      const neglect = Math.min(1, entity.days_since_last_mention / 30);
      if (neglect >= 0.5) {
        risks.push({
          risk_type:   'GOAL_NEGLECT',
          entity_name: entity.name,
          entity_id:   entity.id,
          risk_score:  neglect,
          severity:    SEVERITY(neglect),
          confidence:  0.9,
          description: `Goal "${entity.name}" is not receiving attention.`,
          evidence: [
            `Last referenced ${Math.round(entity.days_since_last_mention)} days ago`,
            `Attention score: ${(entity.attention_score ?? 0).toFixed(2)}`,
          ],
        });
      }
    }

    // 3. Declining attention
    if ((entity.attention_score ?? 1) < 0.2 && entity.importance_score > 0.6) {
      const score = entity.importance_score * (1 - (entity.attention_score ?? 0));
      risks.push({
        risk_type:   'DECLINING_ATTENTION',
        entity_name: entity.name,
        entity_id:   entity.id,
        risk_score:  score,
        severity:    SEVERITY(score),
        confidence:  0.75,
        description: `${entity.name} is important but receiving minimal attention.`,
        evidence: [
          `Attention score: ${(entity.attention_score ?? 0).toFixed(2)}`,
          `Importance score: ${entity.importance_score.toFixed(2)}`,
        ],
      });
    }

    // 4. Decision failure pattern
    if (entity.decision_success_rate < 0.35 && entity.mention_count >= 3) {
      const score = 0.5 + (0.35 - entity.decision_success_rate);
      risks.push({
        risk_type:   'DECISION_FAILURE_PATTERN',
        entity_name: entity.name,
        entity_id:   entity.id,
        risk_score:  Math.min(1, score),
        severity:    SEVERITY(score),
        confidence:  0.70,
        description: `Decisions about ${entity.name} have a poor track record.`,
        evidence: [
          `Decision success rate: ${(entity.decision_success_rate * 100).toFixed(0)}%`,
          `Mentioned ${entity.mention_count} times`,
        ],
      });
    }

    // 5. Single dependency
    if (entity.node_type === 'PERSON' && entity.edge_count >= 5) {
      const depScore = Math.min(1, entity.edge_count / 20);
      if (depScore >= 0.4) {
        risks.push({
          risk_type:   'SINGLE_DEPENDENCY',
          entity_name: entity.name,
          entity_id:   entity.id,
          risk_score:  depScore,
          severity:    SEVERITY(depScore),
          confidence:  0.65,
          description: `Many items depend on ${entity.name}, creating a single point of failure.`,
          evidence: [`Connected to ${entity.edge_count} entities`],
        });
      }
    }

    return risks;
  }

  // ---- Portfolio-level detectors --------------------------

  private concentrationRisks(entities: EntityContext[], totalEdges: number): DetectedRisk[] {
    return entities
      .map(e => ({ e, score: concentrationRisk(e, totalEdges) }))
      .filter(({ score }) => score >= 0.3)
      .map(({ e, score }) => ({
        risk_type:   'CONCENTRATION_RISK' as RiskType,
        entity_name: e.name,
        entity_id:   e.id,
        risk_score:  score,
        severity:    SEVERITY(score),
        confidence:  0.80,
        description: `${e.name} represents a disproportionate share of graph connections.`,
        evidence: [
          `${e.edge_count} of ${totalEdges} total edges (${Math.round(e.edge_count / totalEdges * 100)}%)`,
        ],
      }));
  }
}
