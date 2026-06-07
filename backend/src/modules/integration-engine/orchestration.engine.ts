// ============================================================
// orchestration.engine.ts — Single entry point for all workflows
// No business logic. Pure coordination of existing modules.
// ============================================================
import type { PipelineEngine }  from './pipeline.engine';
import type { WorkflowEngine }  from './workflow.engine';
import type { EventBus }        from './event-bus';
import type { PipelineRun, StageResult } from './integration.types';

export interface OrchestrationResult {
  run:     PipelineRun;
  results: StageResult[];
}

export class OrchestrationEngine {
  constructor(
    private readonly pipeline: PipelineEngine,
    private readonly workflows: WorkflowEngine,
    private readonly bus: EventBus,
  ) {}

  /** Entry point: new observation created by any source */
  async processObservation(userId: string, payload: Record<string, unknown>): Promise<OrchestrationResult> {
    const workflow = this.workflows.get('OBSERVATION_INGESTION');
    if (!workflow) throw new Error('OBSERVATION_INGESTION workflow not registered');
    const result = await this.pipeline.run(workflow, userId, payload);
    this.bus.emit('OBSERVATION_CREATED', userId, payload);
    return result;
  }

  /** Entry point: a decision was evaluated */
  async processDecision(userId: string, payload: Record<string, unknown>): Promise<OrchestrationResult> {
    const workflow = this.workflows.get('DECISION_EVALUATION');
    if (!workflow) throw new Error('DECISION_EVALUATION workflow not registered');
    const result = await this.pipeline.run(workflow, userId, payload);
    this.bus.emit('DECISION_EVALUATED', userId, payload);
    return result;
  }

  /** Entry point: weekly review cycle (cron trigger) */
  async processWeeklyReview(userId: string, payload: Record<string, unknown> = {}): Promise<OrchestrationResult> {
    const workflow = this.workflows.get('WEEKLY_REVIEW');
    if (!workflow) throw new Error('WEEKLY_REVIEW workflow not registered');
    const result = await this.pipeline.run(workflow, userId, payload);
    this.bus.emit('STRATEGIC_REVIEW_CREATED', userId, payload);
    return result;
  }

  /** Entry point: knowledge graph was updated (new nodes/edges) */
  async processGraphUpdate(userId: string, payload: Record<string, unknown>): Promise<OrchestrationResult> {
    const workflow = this.workflows.get('GRAPH_UPDATE');
    if (!workflow) throw new Error('GRAPH_UPDATE workflow not registered');
    const result = await this.pipeline.run(workflow, userId, payload);
    this.bus.emit('GRAPH_UPDATED', userId, payload);
    return result;
  }
}
