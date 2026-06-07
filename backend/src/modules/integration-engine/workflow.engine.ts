// ============================================================
// workflow.engine.ts — Declarative workflow definitions
// No logic here — only stage lists that pipeline.engine executes.
// ============================================================
import type { WorkflowDefinition, StageDefinition } from './integration.types';

/**
 * WorkflowEngine holds the catalogue of named workflows.
 * Stages are injected at construction so modules stay decoupled.
 * The engine's only job is to look up which stages belong to a workflow.
 */
export class WorkflowEngine {
  private readonly registry = new Map<string, WorkflowDefinition>();

  /**
   * register() — add a workflow definition.
   * Called during app bootstrap once per workflow.
   */
  register(def: WorkflowDefinition): void {
    this.registry.set(def.type, def);
  }

  get(type: string): WorkflowDefinition | null {
    return this.registry.get(type) ?? null;
  }

  list(): WorkflowDefinition[] {
    return Array.from(this.registry.values());
  }
}

// ============================================================
// Built-in workflow factories
// These return WorkflowDefinition objects; stages are injected.
// ============================================================

export function observationIngestionWorkflow(stages: StageDefinition[]): WorkflowDefinition {
  return {
    type: 'OBSERVATION_INGESTION',
    description: 'Observation → Classification → Activity Correlation → Graph Update',
    stages,
  };
}

export function decisionEvaluationWorkflow(stages: StageDefinition[]): WorkflowDefinition {
  return {
    type: 'DECISION_EVALUATION',
    description: 'Decision Evaluated → Causal Update → Strategic Review Refresh',
    stages,
  };
}

export function weeklyReviewWorkflow(stages: StageDefinition[]): WorkflowDefinition {
  return {
    type: 'WEEKLY_REVIEW',
    description: 'Weekly Snapshot → Strategic Review → Recommendation Generation',
    stages,
  };
}

export function graphUpdateWorkflow(stages: StageDefinition[]): WorkflowDefinition {
  return {
    type: 'GRAPH_UPDATE',
    description: 'Graph Update → Causal Re-evaluation → Review Trigger',
    stages,
  };
}
