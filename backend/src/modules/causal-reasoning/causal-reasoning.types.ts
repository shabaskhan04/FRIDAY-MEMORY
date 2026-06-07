// ============================================================
// causal-reasoning.types.ts
// ============================================================

export type PatternType =
  | 'REPEATED_SEQUENCE'     // A → B observed N times
  | 'CORRELATION'           // A and B co-occur frequently
  | 'GOAL_ACCELERATOR'      // A increases rate of goal progress
  | 'GOAL_BLOCKER'          // A decreases rate of goal progress
  | 'BEHAVIOR_PATTERN';     // habitual sequence in observations

export type PatternStatus = 'CANDIDATE' | 'CONFIRMED' | 'REJECTED';

export interface CausalPattern {
  id:               string;
  user_id:          string;
  pattern_type:     PatternType;
  cause_node_id:    string | null;
  cause_label:      string;
  effect_node_id:   string | null;
  effect_label:     string;
  description:      string;
  occurrence_count: number;
  confidence:       number;        // 0–1
  status:           PatternStatus;
  first_seen_at:    string;
  last_seen_at:     string;
  created_at:       string;
}

export interface CausalEvidence {
  id:           string;
  pattern_id:   string;
  user_id:      string;
  description:  string;
  source_type:  string;         // 'observation' | 'decision' | 'graph_edge'
  source_id:    string | null;
  weight:       number;
  observed_at:  string;
  created_at:   string;
}

export interface CausalPrediction {
  id:                  string;
  user_id:             string;
  pattern_id:          string;
  input_condition:     string;
  predicted_outcome:   string;
  confidence:          number;
  supporting_patterns: string[];   // pattern IDs
  created_at:          string;
  expires_at:          string | null;
}
