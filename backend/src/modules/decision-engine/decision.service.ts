// ============================================================
// decision.service.ts — Orchestration layer
// ============================================================
import type { DecisionRepository }       from './decision.repository';
import type { DecisionEvaluationEngine } from './decision-evaluation.engine';
import type { DecisionInsights }         from './decision.insights';
import type { DecisionTimelineService } from './decision.timeline';
import type {
  Decision, DecisionEntity, DecisionEvaluation,
  CreateDecisionInput, UpdateDecisionInput, EvaluateDecisionInput,
  DecisionScore, DecisionPattern, RecurringMistake, DecisionTimeline,
  DecisionRelationshipType,
} from './decision.types';
import { CreateDecisionSchema, UpdateDecisionSchema, EvaluateDecisionSchema } from './decision.schemas';

export class DecisionService {
  constructor(
    private readonly repo:       DecisionRepository,
    private readonly evaluator:  DecisionEvaluationEngine,
    private readonly insights:   DecisionInsights,
    private readonly timeline:   DecisionTimelineService,
  ) {}

  // ---- CRUD ------------------------------------------------

  async createDecision(input: CreateDecisionInput): Promise<Decision> {
    const validated = CreateDecisionSchema.parse(input);
    const { entity_node_ids, ...decisionData } = validated as typeof validated & { entity_node_ids?: string[] };
    const decision = await this.repo.create(decisionData as CreateDecisionInput);
    if (entity_node_ids?.length) {
      await Promise.all(
        entity_node_ids.map(nodeId => this.repo.linkToEntity(decision.id, nodeId, 'DECIDES_ON')),
      );
    }
    return decision;
  }

  async getDecision(userId: string, id: string): Promise<Decision | null> {
    return this.repo.getById(id, userId);
  }

  async updateDecision(userId: string, id: string, input: UpdateDecisionInput): Promise<Decision> {
    const validated = UpdateDecisionSchema.parse(input);
    return this.repo.update(id, userId, validated as UpdateDecisionInput);
  }

  async listDecisions(
    userId: string,
    filters?: { status?: string; decision_type?: string },
  ): Promise<Decision[]> {
    return this.repo.listByUser(userId, filters);
  }

  // ---- Graph links -----------------------------------------

  async linkDecisionToEntity(
    decisionId: string,
    nodeId: string,
    relType: DecisionRelationshipType = 'DECIDES_ON',
  ): Promise<DecisionEntity> {
    return this.repo.linkToEntity(decisionId, nodeId, relType);
  }

  async getDecisionEntities(decisionId: string): Promise<DecisionEntity[]> {
    return this.repo.getDecisionEntities(decisionId);
  }

  async getEntityDecisions(nodeId: string): Promise<DecisionEntity[]> {
    return this.repo.getEntityDecisions(nodeId);
  }

  // ---- Evaluation ------------------------------------------

  async evaluateDecision(
    userId: string,
    decisionId: string,
    input: EvaluateDecisionInput,
  ): Promise<DecisionEvaluation> {
    const validated = EvaluateDecisionSchema.parse(input);
    return this.evaluator.evaluate(decisionId, userId, validated);
  }

  async getEvaluationHistory(decisionId: string): Promise<DecisionEvaluation[]> {
    return this.evaluator.getHistory(decisionId);
  }

  async summariseDecision(decisionId: string) {
    return this.evaluator.summarise(decisionId);
  }

  // ---- Insights --------------------------------------------

  async getBestDecisions(userId: string):            Promise<DecisionScore[]>    { return this.insights.getBestDecisions(userId); }
  async getWorstDecisions(userId: string):           Promise<DecisionScore[]>    { return this.insights.getWorstDecisions(userId); }
  async getHighestImpactDecisions(userId: string):   Promise<DecisionScore[]>    { return this.insights.getHighestImpactDecisions(userId); }
  async getDecisionPatterns(userId: string):         Promise<DecisionPattern[]>  { return this.insights.getDecisionPatterns(userId); }
  async getRecurringMistakes(userId: string):        Promise<RecurringMistake[]> { return this.insights.getRecurringMistakes(userId); }
  async getMostSuccessfulDecisionTypes(userId: string): Promise<DecisionPattern[]> { return this.insights.getMostSuccessfulDecisionTypes(userId); }

  // ---- Timeline --------------------------------------------

  async getTimeline(userId: string, granularity: 'day' | 'month' = 'month'): Promise<DecisionTimeline[]> {
    return this.timeline.getTimeline(userId, granularity);
  }
}
