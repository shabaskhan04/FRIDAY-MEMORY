// ============================================================
// activity-insights.ts — Behavioral analytics over activities
// ============================================================
import type { ActivityRepository } from './activity.repository';
import type { Activity, ActivitySummary, DayTimeline } from './activity.types';
import type { ObservationCategory } from '../observation-engine/observation.types';
import { TimelineEngine } from './timeline.engine';

export class ActivityInsights {
  constructor(
    private readonly repo:     ActivityRepository,
    private readonly timeline: TimelineEngine,
  ) {}

  /**
   * getCategorySummary() — total minutes and avg importance per category.
   * Answers: "What did I spend my time on this week?"
   */
  async getCategorySummary(userId: string, days = 7): Promise<ActivitySummary[]> {
    const from  = new Date(Date.now() - days * 86_400_000);
    const acts  = await this.repo.listInRange(userId, from, new Date());
    const map   = new Map<string, { count: number; mins: number; importance: number }>();

    for (const a of acts) {
      const entry = map.get(a.category) ?? { count: 0, mins: 0, importance: 0 };
      entry.count++;
      entry.mins      += a.duration_mins;
      entry.importance += a.importance_score;
      map.set(a.category, entry);
    }

    return Array.from(map.entries())
      .map(([category, s]) => ({
        category:       category as ObservationCategory,
        count:          s.count,
        total_mins:     s.mins,
        avg_importance: s.importance / s.count,
      }))
      .sort((a, b) => b.total_mins - a.total_mins);
  }

  /**
   * getMostActiveHours() — hour-of-day distribution of activity start times.
   * Answers: "When am I most productive?"
   */
  async getMostActiveHours(userId: string, days = 14): Promise<Array<{ hour: number; count: number }>> {
    const from  = new Date(Date.now() - days * 86_400_000);
    const acts  = await this.repo.listInRange(userId, from, new Date());
    const hours = new Array(24).fill(0);
    for (const a of acts) hours[new Date(a.started_at).getHours()]++;
    return hours.map((count, hour) => ({ hour, count })).filter(h => h.count > 0);
  }

  /**
   * getRecentTimeline() — last N days as DayTimelines.
   */
  async getRecentTimeline(userId: string, days = 7): Promise<DayTimeline[]> {
    const from = new Date(Date.now() - days * 86_400_000);
    return this.timeline.reconstructRange(userId, from, new Date());
  }

  /**
   * getTopActivities() — most important activities by score.
   */
  async getTopActivities(userId: string, days = 30, limit = 10): Promise<Activity[]> {
    const from = new Date(Date.now() - days * 86_400_000);
    const acts = await this.repo.listInRange(userId, from, new Date());
    return acts.sort((a, b) => b.importance_score - a.importance_score).slice(0, limit);
  }

  /**
   * getEntityFocus() — which entities appear most across recent activities.
   * Answers: "What am I actually working on?"
   */
  async getEntityFocus(userId: string, days = 7): Promise<Array<{ entity: string; count: number }>> {
    const from  = new Date(Date.now() - days * 86_400_000);
    const acts  = await this.repo.listInRange(userId, from, new Date());
    const counts = new Map<string, number>();
    for (const a of acts) {
      for (const e of a.related_entities) {
        counts.set(e, (counts.get(e) ?? 0) + 1);
      }
    }
    return Array.from(counts.entries())
      .map(([entity, count]) => ({ entity, count }))
      .sort((a, b) => b.count - a.count);
  }
}
