// ============================================================
// causal.types.ts
// ============================================================

export type CausalRelationshipType =
  | 'CAUSED' | 'CONTRIBUTED_TO' | 'ENABLED'
  | 'PREVENTED' | 'ACCELERATED' | 'DELAYED';

// ---- DB row additions on graph_edges ----------------------
// (causal_strength + causal_evidence columns added via migration)

export interface CausalEdge {
  id: string;
  source_node_id: string;
  target_node_id: string;
  relationship_type: CausalRelationshipType;
  causal_strength: number;     // 0–1: how strongly cause → effect
  confidence: number;          // 0–1: how confident we are in this causal link
  source_count: number;
  causal_evidence: CausalEvidence[];
  last_seen_at: string;
}

export interface CausalEvidence {
  description: string;
  source_memory_id?: string;
  timestamp: string;
  weight: number;              // 0–1: how much this evidence contributes
}

// ---- Path analysis -----------------------------------------

export interface CausalPathSegment {
  from_node_id: string;
  to_node_id:   string;
  relationship_type: CausalRelationshipType;
  causal_strength: number;
  confidence: number;
}

export interface CausalPath {
  node_ids:         string[];
  segments:         CausalPathSegment[];
  total_strength:   number;    // geometric mean of segment strengths
  total_confidence: number;    // geometric mean of segment confidences
  hop_count:        number;
}

export interface RootCauseResult {
  root_node_id:   string;
  root_node_name: string;
  path:           CausalPath;
  influence_score: number;
}

export interface DownstreamEffect {
  effect_node_id:   string;
  effect_node_name: string;
  path:             CausalPath;
  impact_score:     number;
}

export interface InfluentialNode {
  node_id:          string;
  node_name:        string;
  outbound_causal_edges: number;
  avg_causal_strength:   number;
  influence_score:       number;
}

// ---- Input -------------------------------------------------

export interface CreateCausalEdgeInput {
  user_id: string;
  source_node_id: string;
  target_node_id: string;
  relationship_type: CausalRelationshipType;
  causal_strength: number;
  confidence?: number;
  evidence?: CausalEvidence[];
  source_memory_ids?: string[];
}

// ---- Observation interfaces (future-compatible) -----------

export type ObservationSourceType =
  | 'GIT_COMMIT' | 'EMAIL_SENT' | 'CALENDAR_EVENT'
  | 'FILE_CHANGE' | 'HEALTH_UPDATE' | 'APP_USAGE' | 'MANUAL';

export interface ObservationSource {
  type: ObservationSourceType;
  external_id: string | null;    // ID in the source system
  metadata: Record<string, unknown>;
}

export interface ObservationEvent {
  id: string;
  user_id: string;
  source: ObservationSource;
  entity_name: string | null;    // extracted entity if any
  description: string;
  observed_at: string;
  processed: boolean;
}
