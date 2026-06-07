// ============================================================
// observation.types.ts
// ============================================================

export type ObservationSource =
  | 'MANUAL'
  | 'GIT_COMMIT' | 'GIT_PR' | 'GIT_BRANCH'
  | 'EMAIL_SENT' | 'EMAIL_RECEIVED'
  | 'CALENDAR_EVENT'
  | 'TASK_CREATED' | 'TASK_COMPLETED'
  | 'FILE_CREATED' | 'FILE_MODIFIED' | 'FILE_DELETED'
  | 'HEALTH_UPDATE'
  | 'APP_USAGE' | 'WEBSITE_VISIT' | 'DEVICE_ACTIVITY'
  | 'DOCUMENT_CREATED' | 'DOCUMENT_UPDATED'
  | 'RESEARCH_SESSION' | 'YOUTUBE_WATCH' | 'BOOK_READING' | 'COURSE_PROGRESS'
  | 'FINANCIAL_TRANSACTION' | 'REVENUE_EVENT' | 'EXPENSE_EVENT'
  | 'PROJECT_MILESTONE'
  | 'SOCIAL_INTERACTION' | 'PHONE_CALL' | 'MESSAGE_SENT' | 'MESSAGE_RECEIVED'
  | 'CUSTOM';

export type ObservationCategory =
  | 'WORK' | 'HEALTH' | 'LEARNING' | 'SOCIAL'
  | 'FINANCE' | 'PROJECT' | 'PERSONAL' | 'SYSTEM';

// ---- DB row -----------------------------------------------

export interface Observation {
  id: string;
  user_id: string;
  source: ObservationSource;
  event_type: string;
  title: string;
  description: string | null;
  occurred_at: string;
  importance_score: number;
  confidence_score: number;
  categories: ObservationCategory[];
  metadata: Record<string, unknown>;
  related_entities: string[];
  is_processed: boolean;
  signal_quality_score: number | null;
  created_at: string;
  updated_at: string;
}

// ---- Inputs -----------------------------------------------

export interface CreateObservationInput {
  user_id: string;
  source: ObservationSource;
  event_type: string;
  title: string;
  description?: string;
  occurred_at?: string;
  importance_score?: number;
  confidence_score?: number;
  categories?: ObservationCategory[];
  metadata?: Record<string, unknown>;
  related_entities?: string[];
}

// ---- Classifier output ------------------------------------

export interface ClassificationResult {
  categories: ObservationCategory[];   // multi-label
  primary_category: ObservationCategory;
  confidence: number;
}

// ---- Scoring ----------------------------------------------

export interface ImportanceScoreBreakdown {
  frequency_score:    number;
  rarity_score:       number;
  entity_score:       number;
  goal_alignment:     number;
  project_relevance:  number;
  final_score:        number;
}

// ---- Insights ---------------------------------------------

export interface ObservationDistribution {
  by_source:   Record<string, number>;
  by_category: Record<string, number>;
  total:       number;
  period_days: number;
}

export interface SourceSummary {
  source: ObservationSource;
  count: number;
  avg_importance: number;
}

export interface ActivityTrend {
  source: ObservationSource;
  category: ObservationCategory;
  label: string;
  direction: 'RISING' | 'DECLINING' | 'STABLE';
  delta_pct: number;       // % change between two periods
}

export interface AttentionDrift {
  from_date: string;
  to_date: string;
  gained: ObservationCategory[];   // categories that grew
  lost:   ObservationCategory[];   // categories that shrank
  shifts: Array<{ category: ObservationCategory; delta_pct: number }>;
}

// ---- Future connector interfaces (architecture only) ------

export interface ConnectorConfig {
  connector_type: string;
  user_id: string;
  enabled: boolean;
  settings: Record<string, unknown>;
}

export interface IConnector {
  readonly type: string;
  /** Called to test auth/configuration — no data fetch */
  validate(config: ConnectorConfig): Promise<boolean>;
  /** Entry point for ingestion when connector is implemented */
  ingest(config: ConnectorConfig, since?: Date): Promise<CreateObservationInput[]>;
}

// Individual connector stubs — implement bodies in Phase 2
export interface IGitConnector      extends IConnector { readonly type: 'GIT'; }
export interface IEmailConnector    extends IConnector { readonly type: 'EMAIL'; }
export interface ICalendarConnector extends IConnector { readonly type: 'CALENDAR'; }
export interface IAndroidConnector  extends IConnector { readonly type: 'ANDROID'; }
export interface IMCPConnector      extends IConnector { readonly type: 'MCP'; }
export interface IFinanceConnector  extends IConnector { readonly type: 'FINANCE'; }
