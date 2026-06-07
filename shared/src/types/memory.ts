// ============================================================
// Memory & Ingest types
// ============================================================

export type IntentTag = "standard" | "spark" | "friction";
export type DeviceType = "mobile" | "desktop";
export type TimeHorizon = "past" | "present" | "future";

export interface TemporalEvent {
  time_horizon: TimeHorizon;
  estimated_date: string;
  era: string;
  event_summary: string;
}

export interface EntityUpdate {
  name: string;
  interaction_type: "family" | "friend" | "business" | "conflict";
  trust_signal: "positive" | "negative" | "neutral";
  ledger_note: string;
}

export interface GroqRouterPayload {
  intent_tag: IntentTag;
  temporal_events: TemporalEvent[];
  entity_updates: EntityUpdate[];
  extracted_tasks: string[];
}

export interface IngestRequestBody {
  content: string;
  device_type?: DeviceType;
  local_timezone?: string;
  location_text?: string;
  location_lat?: number;
  location_lon?: number;
}

export interface IngestResponse {
  success: boolean;
  raw_ledger_id: string;
  intent_tag: IntentTag;
  temporal_count: number;
  entity_count: number;
  task_count: number;
  embedding_stored: boolean;
}

// ============================================================
// Search & Retrieval types
// ============================================================

export interface HybridMemoryRow {
  id: string;
  content: string;
  created_at: string;
  intent_tag: string | null;
  local_timezone: string | null;
  location_text: string | null;
  semantic_score: number;
  keyword_score: number;
  entity_score: number;
  recency_score: number;
  final_score: number;
  similarity: number; // alias of final_score — keeps UI compat
  matched_entities: string[];
}

export interface CitedMemory {
  id: string;
  content: string;
  created_at: string;
  intent_tag: string | null;
  similarity: number;
  final_score: number;
  semantic_score: number;
  keyword_score: number;
  entity_score: number;
  recency_score: number;
  matched_entities: string[];
}

export interface AskRequestBody {
  query: string;
  debug?: boolean;
}

export interface AskResponse {
  answer: string;
  citations: CitedMemory[];
  cited_ids: string[];
  query_type: string;
  entities_detected: string[];
}

export interface SearchRequestBody {
  query: string;
  limit?: number;
  debug?: boolean;
}

export interface SearchResponse {
  memories: HybridMemoryRow[];
  query_analysis?: {
    query_type: string;
    entities: unknown[];
    weights: unknown;
  };
}

export interface ReflectionInsight {
  type: string;
  content: string;
  source_memory_ids: string[];
}

export interface ReflectRequestBody {
  hours_back?: number;
}

export interface ReflectResponse {
  status: "ok" | "skipped";
  insights_saved?: number;
  reason?: string;
}
