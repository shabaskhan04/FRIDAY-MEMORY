// ============================================================
// activity.service.ts — Orchestration: obs → clusters → activities
// ============================================================
import type { ActivityRepository } from './activity.repository';
import type { CorrelationEngine }  from './correlation.engine';
import type { TimelineEngine }     from './timeline.engine';
import type { ActivityInsights }   from './activity-insights';
import type { Observation }        from '../observation-engine/observation.types';
import type { Activity, ActivityCandidate, DayTimeline, ActivitySummary } from './activity.types';
import { getSignalQuality }        from './activity.scoring';

export class ActivityService {
  constructor(
    private readonly repo:        ActivityRepository,
    private readonly correlator:  CorrelationEngine,
    private readonly timeline:    TimelineEngine,
    private readonly insights:    ActivityInsights,
  ) {}

  // ---- Core pipeline: observations → activities -----------

  /**
   * processObservations() — run the full pipeline:
   *   1. Correlate observations into clusters
   *   2. Score each cluster
   *   3. Persist activities + join records
   *   Returns persisted Activity records.
   */
  async processObservations(
    userId: string,
    observations: Observation[],
  ): Promise<Activity[]> {
    const candidates: ActivityCandidate[] = this.correlator.correlate(observations);
    if (!candidates.length) return [];

    const inputs = candidates.map(c => ({
      user_id:          userId,
      title:            c.title,
      category:         c.category,
      started_at:       c.cluster.start_time.toISOString(),
      ended_at:         c.cluster.end_time.toISOString(),
      importance_score: c.importance_score,
      confidence_score: c.confidence_score,
      signal_quality:   c.signal_quality,
      related_entities: c.cluster.entities,
      metadata:         {},
    }));

    const activities = await this.repo.createMany(inputs);

    // Link observation IDs to each activity
    for (let i = 0; i < activities.length; i++) {
      const obsIds = candidates[i].cluster.observations.map(o => o.id);
      await this.repo.linkObservations(activities[i].id, obsIds);
    }

    return activities;
  }

  /**
   * enrichSignalQuality() — update signal_quality_score on raw observations.
   * Called after observations are stored but before correlation.
   * Returns the observation list with quality scores filled in (in-memory only —
   * caller persists via observation repo).
   */
  enrichSignalQuality(observations: Observation[]): Array<Observation & { signal_quality_score: number }> {
    return observations.map(o => ({
      ...o,
      signal_quality_score: getSignalQuality(o.source).score,
    }));
  }

  // ---- Queries --------------------------------------------

  async getActivity(userId: string, id: string): Promise<Activity | null> {
    return this.repo.getById(id, userId);
  }

  async getActivityWithObservations(userId: string, id: string): Promise<{ activity: Activity; observation_ids: string[] } | null> {
    const activity = await this.repo.getById(id, userId);
    if (!activity) return null;
    const observation_ids = await this.repo.getObservationIds(id);
    return { activity, observation_ids };
  }

  // ---- Timeline -------------------------------------------

  async getDayTimeline(userId: string, date: Date): Promise<DayTimeline> {
    return this.timeline.reconstructDay(userId, date);
  }

  async getRecentTimeline(userId: string, days = 7): Promise<DayTimeline[]> {
    return this.insights.getRecentTimeline(userId, days);
  }

  // ---- Insights -------------------------------------------

  async getCategorySummary(userId: string, days?: number): Promise<ActivitySummary[]> {
    return this.insights.getCategorySummary(userId, days);
  }

  async getTopActivities(userId: string, days?: number): Promise<Activity[]> {
    return this.insights.getTopActivities(userId, days);
  }

  async getMostActiveHours(userId: string, days?: number): Promise<Array<{ hour: number; count: number }>> {
    return this.insights.getMostActiveHours(userId, days);
  }

  async getEntityFocus(userId: string, days?: number): Promise<Array<{ entity: string; count: number }>> {
    return this.insights.getEntityFocus(userId, days);
  }
}
