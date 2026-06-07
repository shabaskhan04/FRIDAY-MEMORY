// ============================================================
// ingestion.types.ts
// ============================================================

export type IngestionSourceType =
  | 'GITHUB' | 'GOOGLE_CALENDAR' | 'GMAIL' | 'GOOGLE_DOCS'
  | 'MARKDOWN' | 'LOCAL_FOLDER' | 'CSV' | 'JSON'
  | 'WHATSAPP' | 'TELEGRAM';

export type SyncStatus = 'IDLE' | 'RUNNING' | 'FAILED' | 'PAUSED';
export type RunStatus  = 'RUNNING' | 'SUCCESS' | 'PARTIAL' | 'FAILED';
export type EventStatus = 'PENDING' | 'INGESTED' | 'DUPLICATE' | 'FAILED';

export interface IngestionSource {
  id:                   string;
  user_id:              string;
  source_type:          IngestionSourceType;
  name:                 string;
  config:               Record<string, unknown>;
  enabled:              boolean;
  last_sync_at:         string | null;
  sync_status:          SyncStatus;
  health_score:         number;
  consecutive_failures: number;
  created_at:           string;
  updated_at:           string;
}

export interface IngestionRun {
  id:               string;
  source_id:        string;
  user_id:          string;
  started_at:       string;
  completed_at:     string | null;
  status:           RunStatus;
  records_fetched:  number;
  records_ingested: number;
  records_skipped:  number;
  records_failed:   number;
  error_message:    string | null;
}

export interface IngestionEvent {
  id:                 string;
  run_id:             string;
  source_id:          string;
  user_id:            string;
  external_id:        string | null;
  content_hash:       string;
  raw_content:        string;
  normalized_content: Record<string, unknown>;
  source_type:        IngestionSourceType;
  status:             EventStatus;
  error_message:      string | null;
  created_at:         string;
}

export interface IngestionFailure {
  id:            string;
  source_id:     string;
  run_id:        string;
  user_id:       string;
  error_message: string;
  error_code:    string | null;
  retry_count:   number;
  max_retries:   number;
  next_retry_at: string | null;
  is_dead_letter: boolean;
  created_at:    string;
}

export interface CreateSourceInput {
  source_type: IngestionSourceType;
  name: string;
  config?: Record<string, unknown>;
  enabled?: boolean;
}

export interface RunResult {
  run:              IngestionRun;
  records_fetched:  number;
  records_ingested: number;
  records_skipped:  number;
  records_failed:   number;
}

export interface NormalizedContent {
  title:        string;
  body:         string;
  occurred_at:  string;
  external_id:  string;
  content_hash: string;
  metadata:     Record<string, unknown>;
}
