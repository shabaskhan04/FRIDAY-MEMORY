// ============================================================
// activity.scoring.ts — Signal quality + activity scoring
// Pure functions, no I/O.
// ============================================================
import type { ObservationSource } from '../observation-engine/observation.types';
import type { ObservationCluster, SignalQualityResult, SignalQualityTier } from './activity.types';

// ---- Signal quality per source ---------------------------
// Represents how reliably a source reflects intentional human activity.

const SIGNAL_QUALITY: Record<ObservationSource, number> = {
  // High confidence — direct work artefacts
  GIT_COMMIT:             0.95,
  GIT_PR:                 0.95,
  GIT_BRANCH:             0.85,
  TASK_COMPLETED:         0.92,
  PROJECT_MILESTONE:      0.97,
  REVENUE_EVENT:          0.97,
  EXPENSE_EVENT:          0.90,
  FINANCIAL_TRANSACTION:  0.88,
  DOCUMENT_CREATED:       0.85,
  DOCUMENT_UPDATED:       0.80,
  // Medium — inferred or semi-structured
  MANUAL:                 0.80,
  EMAIL_SENT:             0.78,
  CALENDAR_EVENT:         0.82,
  TASK_CREATED:           0.75,
  HEALTH_UPDATE:          0.88,
  RESEARCH_SESSION:       0.80,
  BOOK_READING:           0.78,
  COURSE_PROGRESS:        0.78,
  PHONE_CALL:             0.80,
  SOCIAL_INTERACTION:     0.75,
  // Low — passive / ambient signals
  EMAIL_RECEIVED:         0.50,
  FILE_CREATED:           0.60,
  FILE_MODIFIED:          0.55,
  FILE_DELETED:           0.45,
  WEBSITE_VISIT:          0.35,
  APP_USAGE:              0.30,
  MESSAGE_SENT:           0.65,
  MESSAGE_RECEIVED:       0.40,
  YOUTUBE_WATCH:          0.45,
  // Noise
  DEVICE_ACTIVITY:        0.05,
  CUSTOM:                 0.50,
};

export function getSignalQuality(source: ObservationSource): SignalQualityResult {
  const score = SIGNAL_QUALITY[source] ?? 0.50;
  const tier: SignalQualityTier =
    score >= 0.85 ? 'HIGH' :
    score >= 0.60 ? 'MEDIUM' :
    score >= 0.25 ? 'LOW' :
    'NOISE';
  return { score, tier, source };
}

/**
 * clusterSignalQuality() — weighted average signal quality for a cluster.
 * Higher-quality signals contribute more weight.
 */
export function clusterSignalQuality(cluster: ObservationCluster): number {
  const obs = cluster.observations;
  if (!obs.length) return 0;

  // Weight each observation's quality score by itself (higher = more weight)
  const totalWeight = obs.reduce((s, o) => {
    const q = SIGNAL_QUALITY[o.source] ?? 0.50;
    return s + q;
  }, 0);
  const weightedSum = obs.reduce((s, o) => {
    const q = SIGNAL_QUALITY[o.source] ?? 0.50;
    return s + q * q; // q * weight(q)
  }, 0);
  return Math.min(1, weightedSum / totalWeight);
}

/**
 * scoreActivity() — composite importance for a cluster.
 *
 * Formula:
 *   importance = signal_quality * 0.35
 *              + avg_obs_importance * 0.40
 *              + duration_factor   * 0.15
 *              + entity_factor     * 0.10
 */
export function scoreActivity(cluster: ObservationCluster): {
  importance_score: number;
  confidence_score: number;
  signal_quality: number;
} {
  const signal_quality = clusterSignalQuality(cluster);

  const avg_obs_importance = cluster.observations.reduce((s, o) => s + o.importance_score, 0)
    / cluster.observations.length;

  const durationMins   = (cluster.end_time.getTime() - cluster.start_time.getTime()) / 60_000;
  const duration_factor = Math.min(1, durationMins / 120); // caps at 2 hours

  const entity_factor  = Math.min(1, cluster.entities.length / 5);

  const importance_score = Math.min(1, Math.max(0,
    signal_quality      * 0.35 +
    avg_obs_importance  * 0.40 +
    duration_factor     * 0.15 +
    entity_factor       * 0.10,
  ));

  // Confidence: how consistently the cluster signals agree
  const confidence_score = Math.min(1,
    cluster.avg_signal_quality * 0.6 +
    (cluster.observations.length >= 3 ? 0.4 : cluster.observations.length * 0.13),
  );

  return { importance_score, confidence_score, signal_quality };
}
