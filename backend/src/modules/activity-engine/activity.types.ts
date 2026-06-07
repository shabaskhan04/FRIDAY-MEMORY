// ============================================================
// activity.types.ts
// ============================================================
import type { Observation, ObservationSource, ObservationCategory } from '../observation-engine/observation.types';

// ---- DB rows ----------------------------------------------

export interface Activity {
  id: string;
  user_id: string;
  title: string;
  category: ObservationCategory;
  started_at: string;
  ended_at: string;
  duration_mins: number;
  importance_score: number;
  confidence_score: number;
  signal_quality: number;
  related_entities: string[];
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface CreateActivityInput {
  user_id: string;
  title: string;
  category: ObservationCategory;
  started_at: string;
  ended_at: string;
  importance_score?: number;
  confidence_score?: number;
  signal_quality?: number;
  related_entities?: string[];
  metadata?: Record<string, unknown>;
}

// ---- Correlation ------------------------------------------

/** A cluster is a group of temporally/semantically related observations */
export interface ObservationCluster {
  observations:    Observation[];
  start_time:      Date;
  end_time:        Date;
  dominant_category: ObservationCategory;
  entities:        string[];      // union of related_entities across cluster
  avg_signal_quality: number;
}

/** Result of naming + scoring a cluster — ready to persist as an Activity */
export interface ActivityCandidate {
  cluster:         ObservationCluster;
  title:           string;
  category:        ObservationCategory;
  importance_score: number;
  confidence_score: number;
  signal_quality:  number;
}

// ---- Timeline ---------------------------------------------

export interface TimeBlock {
  activity:    Activity;
  observation_ids: string[];
  label:       string;            // human-readable: "09:00–11:30 · Worked on Orin"
}

export interface DayTimeline {
  date:        string;            // YYYY-MM-DD
  blocks:      TimeBlock[];
  total_active_mins: number;
  top_category: ObservationCategory;
}

// ---- Insights ---------------------------------------------

export interface ActivitySummary {
  category: ObservationCategory;
  count: number;
  total_mins: number;
  avg_importance: number;
}

// ---- Signal quality (per-source baseline) ----------------

export type SignalQualityTier = 'HIGH' | 'MEDIUM' | 'LOW' | 'NOISE';

export interface SignalQualityResult {
  score: number;               // 0–1
  tier:  SignalQualityTier;
  source: ObservationSource;
}
