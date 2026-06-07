// ============================================================
// integration.types.ts
// ============================================================

// ---- Pipeline primitives ----------------------------------

export type PipelineStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'SKIPPED';

export type WorkflowType =
  | 'OBSERVATION_INGESTION'
  | 'DECISION_EVALUATION'
  | 'WEEKLY_REVIEW'
  | 'GRAPH_UPDATE'
  | 'MANUAL';

export interface PipelineRun {
  id:            string;
  user_id:       string;
  workflow_type: WorkflowType;
  status:        PipelineStatus;
  started_at:    string;
  completed_at:  string | null;
  duration_ms:   number | null;
  metadata:      Record<string, unknown>;
}

export interface PipelineStage {
  id:              string;
  pipeline_run_id: string;
  stage_name:      string;
  status:          PipelineStatus;
  started_at:      string;
  completed_at:    string | null;
  duration_ms:     number | null;
  error:           string | null;
  metadata:        Record<string, unknown>;
}

// ---- Stage definition (compile-time workflow spec) --------

export type StageFn<TIn = unknown, TOut = unknown> = (
  input: TIn,
  ctx: StageContext,
) => Promise<TOut>;

export interface StageDefinition<TIn = unknown, TOut = unknown> {
  name:        string;
  fn:          StageFn<TIn, TOut>;
  maxRetries?: number;       // default 2
  recoverable?: boolean;     // default true — failure skips, not halts
  timeoutMs?:  number;       // default 30_000
}

export interface StageContext {
  run_id:   string;
  user_id:  string;
  workflow: WorkflowType;
}

export interface StageResult<T = unknown> {
  stage_name: string;
  status:     PipelineStatus;
  output:     T | null;
  error:      string | null;
  duration_ms: number;
  retries:    number;
}

// ---- Failure tracking ------------------------------------

export interface FailureRecord {
  run_id:      string;
  stage_name:  string;
  error:       string;
  retryCount:  number;
  recoverable: boolean;
  timestamp:   string;
}

// ---- Events (event bus) ----------------------------------

export type IntegrationEventType =
  | 'OBSERVATION_CREATED'
  | 'ACTIVITY_CREATED'
  | 'GRAPH_UPDATED'
  | 'DECISION_CREATED'
  | 'DECISION_EVALUATED'
  | 'CAUSAL_LINK_CREATED'
  | 'STRATEGIC_REVIEW_CREATED'
  | 'PIPELINE_COMPLETED'
  | 'PIPELINE_FAILED';

export interface IntegrationEvent<T = unknown> {
  type:       IntegrationEventType;
  user_id:    string;
  payload:    T;
  emitted_at: string;
}

export type EventHandler<T = unknown> = (event: IntegrationEvent<T>) => void | Promise<void>;

// ---- Workflow definition ---------------------------------

export interface WorkflowDefinition {
  type:       WorkflowType;
  stages:     StageDefinition[];
  description: string;
}

// ---- Metrics ---------------------------------------------

export interface PipelineMetrics {
  total_runs:           number;
  success_rate:         number;
  avg_duration_ms:      number;
  failure_rate:         number;
  most_failed_stage:    string | null;
  retry_rate:           number;
}

export interface WorkflowMetrics {
  workflow_type:   WorkflowType;
  run_count:       number;
  success_rate:    number;
  avg_duration_ms: number;
}

// ---- Future connector extension points (interfaces only) -

export interface IIntegrationExtension {
  readonly name: string;
  /** Called when a pipeline event is emitted — extension can react */
  onEvent?(event: IntegrationEvent): Promise<void>;
  /** Called at pipeline start — extension can inject additional stages */
  contributeStages?(): StageDefinition[];
}

// Stubs — bodies implemented in Phase 2
export interface IMCPExtension      extends IIntegrationExtension { readonly name: 'MCP'; }
export interface IAndroidExtension  extends IIntegrationExtension { readonly name: 'ANDROID'; }
export interface IGitExtension      extends IIntegrationExtension { readonly name: 'GIT'; }
export interface IEmailExtension    extends IIntegrationExtension { readonly name: 'EMAIL'; }
export interface ICalendarExtension extends IIntegrationExtension { readonly name: 'CALENDAR'; }
export interface IFinanceExtension  extends IIntegrationExtension { readonly name: 'FINANCE'; }
export interface IActionExtension   extends IIntegrationExtension { readonly name: 'ACTION_ENGINE'; }
