// ============================================================
// digital-twin.types.ts
// ============================================================

export type TraitCategory =
  | 'WORK_STYLE' | 'COMMUNICATION' | 'DECISION_MAKING'
  | 'RISK_TOLERANCE' | 'PRODUCTIVITY' | 'LEARNING' | 'SOCIAL' | 'PREFERENCES';

export type PredictionType =
  | 'NEXT_FOCUS' | 'PREFERRED_WORK_TIME' | 'DECISION_TENDENCY'
  | 'LIKELY_PRIORITY' | 'COLLABORATION_PREFERENCE';

export interface DigitalTwinProfile {
  id:                  string;
  user_id:             string;
  display_name:        string | null;
  summary:             string | null;
  top_goals:           string[];
  top_projects:        string[];
  top_people:          string[];
  work_hours_pattern:  Record<string, number>;  // hour → activity_count
  productivity_peak:   string | null;           // e.g. "morning"
  avg_decision_confidence: number;
  risk_profile:        'CONSERVATIVE' | 'MODERATE' | 'AGGRESSIVE';
  last_rebuilt_at:     string | null;
  version:             number;
  created_at:          string;
  updated_at:          string;
}

export interface DigitalTwinTrait {
  id:              string;
  user_id:         string;
  profile_id:      string;
  category:        TraitCategory;
  trait_name:      string;
  trait_value:     string;
  confidence:      number;
  evidence_count:  number;
  source_types:    string[];
  first_seen_at:   string;
  last_seen_at:    string;
}

export interface DigitalTwinPrediction {
  id:              string;
  user_id:         string;
  profile_id:      string;
  prediction_type: PredictionType;
  prediction:      string;
  confidence:      number;
  evidence:        PredictionEvidence[];
  supporting_node_ids: string[];
  supporting_memory_ids: string[];
  created_at:      string;
  expires_at:      string | null;
}

export interface PredictionEvidence {
  description: string;
  weight:      number;
  source:      string;
}

export interface SelfModel {
  profile:     DigitalTwinProfile;
  traits:      DigitalTwinTrait[];
  predictions: DigitalTwinPrediction[];
  generated_at: string;
}
