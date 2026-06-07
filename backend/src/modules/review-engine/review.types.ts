// ============================================================
// review.types.ts
// ============================================================

// ---- Input context (consumed from other engines) ----------

export interface EntityContext {
  id: string;
  name: string;
  node_type: string;                 // 'PROJECT' | 'GOAL' | 'BUSINESS' | 'PERSON' | ...
  importance_score: number;          // from graph
  attention_score: number;           // from attention engine
  goal_alignment_score: number;      // from goal-alignment engine
  causal_influence_score: number;    // from causal engine (outbound influence)
  decision_success_rate: number;     // from decision engine
  days_since_last_mention: number;   // from graph node
  edge_count: number;
  mention_count: number;
}

export interface ReviewContext {
  user_id: string;
  period_start: Date;
  period_end:   Date;
  entities:     EntityContext[];     // all relevant entities for this review
}

// ---- Focus engine -----------------------------------------

export interface FocusArea {
  entity:          EntityContext;
  focus_score:     number;           // 0–1, how much focus this area is getting
  result_score:    number;           // 0–1, output being produced
  verdict:         FocusVerdict;
  mismatch_delta:  number;           // focus - result: positive = over-invested
}

export type FocusVerdict =
  | 'HIGH_FOCUS_HIGH_RESULT'     // ideal
  | 'HIGH_FOCUS_LOW_RESULT'      // over-invested, under-performing
  | 'LOW_FOCUS_HIGH_OPPORTUNITY' // neglected but high potential
  | 'LOW_FOCUS_LOW_RESULT'       // irrelevant or deprioritised
  | 'BALANCED';

// ---- Risk engine ------------------------------------------

export type RiskType =
  | 'PROJECT_STAGNATION'
  | 'GOAL_NEGLECT'
  | 'DECLINING_ATTENTION'
  | 'DECISION_FAILURE_PATTERN'
  | 'RELATIONSHIP_DECAY'
  | 'CONCENTRATION_RISK'
  | 'SINGLE_DEPENDENCY';

export interface DetectedRisk {
  risk_type:   RiskType;
  entity_name: string;
  entity_id:   string;
  risk_score:  number;   // 0–1
  severity:    'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  confidence:  number;
  description: string;
  evidence:    string[];
}

// ---- Priority engine --------------------------------------

export interface PriorityScore {
  entity:       EntityContext;
  priority_rank: number;
  priority_score: number;          // 0–1
  factors: {
    goal_alignment:     number;
    attention:          number;
    decision_impact:    number;
    causal_influence:   number;
    growth_trend:       number;
  };
}

// ---- Recommendation engine --------------------------------

export type RecommendationAction =
  | 'FOCUS_MORE' | 'FOCUS_LESS' | 'MAINTAIN'
  | 'INVEST' | 'DELEGATE' | 'REVIEW' | 'ABANDON';

export interface Recommendation {
  entity_id:   string;
  entity_name: string;
  action:      RecommendationAction;
  reasoning:   string;
  evidence:    EvidenceItem[];
  confidence:  number;
}

export interface EvidenceItem {
  factor:  string;
  value:   number | string;
  weight:  number;
}

// ---- Strategic review output (full) ----------------------

export interface StrategicReview {
  user_id:       string;
  period_start:  string;
  period_end:    string;
  generated_at:  string;
  current_focus:      FocusArea[];           // sorted by focus_score desc
  top_opportunities:  EntityContext[];
  top_risks:          DetectedRisk[];
  neglected_goals:    EntityContext[];
  underperforming:    FocusArea[];           // HIGH_FOCUS_LOW_RESULT
  emerging_projects:  EntityContext[];
  priorities:         PriorityScore[];
  recommendations:    Recommendation[];
  overall_score:      number;                // 0–1 aggregate strategic health
  confidence:         number;
}

// ---- DB rows ---------------------------------------------

export interface StoredReview {
  id: string;
  user_id: string;
  period_start: string;
  period_end: string;
  trigger: string;
  summary: StrategicReview;
  overall_score: number;
  confidence: number;
  created_at: string;
}
