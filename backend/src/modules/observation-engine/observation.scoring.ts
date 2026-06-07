// ============================================================
// observation.scoring.ts — Importance scoring with explainability
// Pure functions, no I/O.
// ============================================================
import type { Observation, ImportanceScoreBreakdown, ObservationSource } from './observation.types';

// ---- Source rarity weights --------------------------------
// Rare signals score higher than noisy ones.
// APP_USAGE and WEBSITE_VISIT are common → low rarity weight.

const SOURCE_RARITY: Partial<Record<ObservationSource, number>> = {
  PROJECT_MILESTONE:  0.95,
  REVENUE_EVENT:      0.90,
  GIT_PR:             0.80,
  CALENDAR_EVENT:     0.65,
  TASK_COMPLETED:     0.70,
  EMAIL_SENT:         0.55,
  EMAIL_RECEIVED:     0.45,
  GIT_COMMIT:         0.60,
  HEALTH_UPDATE:      0.75,
  FINANCIAL_TRANSACTION: 0.70,
  EXPENSE_EVENT:      0.65,
  RESEARCH_SESSION:   0.70,
  BOOK_READING:       0.70,
  COURSE_PROGRESS:    0.65,
  APP_USAGE:          0.20,
  WEBSITE_VISIT:      0.15,
  DEVICE_ACTIVITY:    0.10,
  MANUAL:             0.60,
  CUSTOM:             0.50,
};

const FREQUENCY_CAP = 50;

/**
 * calculateImportanceScore()
 *
 * Formula:
 *   final = frequency * 0.15
 *         + rarity    * 0.25
 *         + entity    * 0.25
 *         + goal_alignment  * 0.20
 *         + project_relevance * 0.15
 *
 * All factors 0–1. Result clamped to [0, 1].
 */
export function calculateImportanceScore(
  obs: Pick<Observation, 'source' | 'title' | 'description' | 'related_entities'>,
  context: {
    sourceFrequencyInWindow: number;   // how many times this source appeared recently
    entityImportanceScores:  number[]; // importance_score of related graph nodes
    goalAlignedEntityCount:  number;   // how many related_entities are GOAL nodes
    projectRelatedEntityCount: number; // how many are PROJECT nodes
  },
): ImportanceScoreBreakdown {
  // Frequency: log-norm — common = low score
  const frequency_score = 1 - Math.log1p(Math.min(context.sourceFrequencyInWindow, FREQUENCY_CAP))
    / Math.log1p(FREQUENCY_CAP);

  const rarity_score = SOURCE_RARITY[obs.source] ?? 0.50;

  const entity_score = context.entityImportanceScores.length
    ? context.entityImportanceScores.reduce((s, v) => s + v, 0) / context.entityImportanceScores.length
    : 0.3;  // default when entity importance is unknown

  const total_entities = Math.max(obs.related_entities.length, 1);
  const goal_alignment = Math.min(1, context.goalAlignedEntityCount / total_entities);
  const project_relevance = Math.min(1, context.projectRelatedEntityCount / total_entities);

  const final_score = Math.min(1, Math.max(0,
    frequency_score    * 0.15 +
    rarity_score       * 0.25 +
    entity_score       * 0.25 +
    goal_alignment     * 0.20 +
    project_relevance  * 0.15,
  ));

  return {
    frequency_score,
    rarity_score,
    entity_score,
    goal_alignment,
    project_relevance,
    final_score,
  };
}

/**
 * scoreObservationBatch() — rank a list of observations by importance.
 * Uses only the observation data itself (no external context) as a fast default.
 */
export function scoreObservationBatch(
  observations: Observation[],
): Array<{ obs: Observation; score: ImportanceScoreBreakdown }> {
  // Build source frequency map within the batch
  const freqMap = new Map<string, number>();
  for (const o of observations) {
    freqMap.set(o.source, (freqMap.get(o.source) ?? 0) + 1);
  }

  return observations
    .map(obs => ({
      obs,
      score: calculateImportanceScore(obs, {
        sourceFrequencyInWindow:   freqMap.get(obs.source) ?? 1,
        entityImportanceScores:    [],
        goalAlignedEntityCount:    0,
        projectRelatedEntityCount: 0,
      }),
    }))
    .sort((a, b) => b.score.final_score - a.score.final_score);
}
