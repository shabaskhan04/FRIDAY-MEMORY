// ============================================================
// integration.service.ts — Public API + extension registry
// ============================================================
import type { OrchestrationEngine }  from './orchestration.engine';
import type { IntegrationMetrics }   from './integration.metrics';
import type { IntegrationInsights }  from './integration-insights';
import type { WorkflowEngine, observationIngestionWorkflow } from './workflow.engine';
import type { IIntegrationExtension, WorkflowDefinition } from './integration.types';

export class IntegrationService {
  private readonly extensions = new Map<string, IIntegrationExtension>();

  constructor(
    private readonly orchestration: OrchestrationEngine,
    private readonly metrics:       IntegrationMetrics,
    private readonly insights:      IntegrationInsights,
    private readonly workflows:     WorkflowEngine,
  ) {}

  // ---- Orchestration entry points -------------------------

  processObservation(userId: string, payload: Record<string, unknown>) {
    return this.orchestration.processObservation(userId, payload);
  }

  processDecision(userId: string, payload: Record<string, unknown>) {
    return this.orchestration.processDecision(userId, payload);
  }

  processWeeklyReview(userId: string, payload?: Record<string, unknown>) {
    return this.orchestration.processWeeklyReview(userId, payload);
  }

  processGraphUpdate(userId: string, payload: Record<string, unknown>) {
    return this.orchestration.processGraphUpdate(userId, payload);
  }

  // ---- Metrics + insights ---------------------------------

  getPipelineMetrics(userId: string) { return this.metrics.getPipelineMetrics(userId); }
  getWorkflowMetrics(userId: string) { return this.metrics.getWorkflowMetrics(userId); }
  getPipelineHealth(userId: string)  { return this.insights.getPipelineHealth(userId); }
  getBottlenecks(userId: string)     { return this.insights.getBottlenecks(userId); }
  getFailurePatterns(userId: string) { return this.insights.getFailurePatterns(userId); }
  getSlowestStages(userId: string)   { return this.insights.getSlowestStages(userId); }

  // ---- Workflow registry ----------------------------------

  registerWorkflow(def: WorkflowDefinition): void {
    this.workflows.register(def);
  }

  listWorkflows(): WorkflowDefinition[] {
    return this.workflows.list();
  }

  // ---- Extension registry (future connectors) ------------

  registerExtension(ext: IIntegrationExtension): void {
    this.extensions.set(ext.name, ext);
  }

  listExtensions(): string[] {
    return Array.from(this.extensions.keys());
  }
}
