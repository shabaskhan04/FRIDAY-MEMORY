// ============================================================
// decision.types.ts
// ============================================================

export type DecisionStatus = 'PLANNED' | 'ACTIVE' | 'COMPLETED' | 'ABANDONED' | 'FAILED';

export type DecisionRelationshipType =
  | 'DECIDES_ON' | 'AFFECTS' | 'SUPPORTS' | 'BLOCKS' | 'RESULTED_IN';

// ---- DB rows -----------------------------------------------

export interface Decision {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  decision_type: string;            // e.g. 'BUSINESS', 'HEALTH', 'PRODUCT', 'GENERAL'
  reasoning: string | null;
  expected_outcome: string | null;
  expected_success_probability: number;
  actual_outcome: string | null;
  status: DecisionStatus;
  confidence_score: number;
  decision_date: string;
  review_date: string | null;
  created_at: string;
  updated_at: string;
}

export interface DecisionEntity {
  id: string;
  decision_id: string;
  node_id: string;
  relationship_type: DecisionRelationshipType;
  created_at: string;
}

export interface DecisionEvaluation {
  id: string;
  decision_id: string;
  success_score: number;
  accuracy_score: number;
  lessons: string[];
  notes: string | null;
  evaluated_at: string;
}

// ---- Inputs ------------------------------------------------

export interface CreateDecisionInput {
  user_id: string;
  title: string;
  description?: string;
  decision_type?: string;
  reasoning?: string;
  expected_outcome?: string;
  expected_success_probability?: number;
  confidence_score?: number;
  decision_date?: string;
  review_date?: string;
  entity_node_ids?: string[];
}

export interface UpdateDecisionInput {
  title?: string;
  description?: string;
  reasoning?: string;
  expected_outcome?: string;
  expected_success_probability?: number;
  actual_outcome?: string;
  status?: DecisionStatus;
  confidence_score?: number;
  review_date?: string;
}

export interface EvaluateDecisionInput {
  success_score: number;
  accuracy_score: number;
  lessons?: string[];
  notes?: string;
}

// ---- Analytics types ---------------------------------------

export interface DecisionScore {
  decision: Decision;
  success_score: number;
  accuracy_score: number;
  impact_score: number;          // derived from entity connection count + importance
  composite_score: number;
}

export interface DecisionPattern {
  pattern_type: string;          // e.g. 'BUSINESS', 'HEALTH'
  count: number;
  avg_success: number;
  avg_accuracy: number;
  examples: string[];            // decision titles
}

export interface DecisionTimeline {
  date: string;
  decisions: Array<{
    id: string;
    title: string;
    status: DecisionStatus;
    confidence_score: number;
  }>;
}

export interface RecurringMistake {
  pattern: string;
  count: number;
  decision_ids: string[];
  avg_failure_score: number;
}
