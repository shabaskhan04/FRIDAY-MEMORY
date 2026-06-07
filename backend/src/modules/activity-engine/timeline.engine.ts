// ============================================================
// timeline.engine.ts — Reconstruct time blocks from activities
// ============================================================
import type { ActivityRepository } from './activity.repository';
import type { Activity, TimeBlock, DayTimeline } from './activity.types';
import type { ObservationCategory } from '../observation-engine/observation.types';

export class TimelineEngine {
  constructor(private readonly repo: ActivityRepository) {}

  /**
   * reconstructDay() — build a DayTimeline for a given date.
   *
   * Output example:
   *   09:00–11:30 · Worked on Orin        (PROJECT)
   *   12:00–12:45 · Gym                   (HEALTH)
   *   13:00–14:00 · Khan Designs clients  (WORK)
   */
  async reconstructDay(userId: string, date: Date): Promise<DayTimeline> {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start.getTime() + 86_400_000);

    const activities = await this.repo.listInRange(userId, start, end);
    const blocks     = activities.map(a => this.toBlock(a));
    const totalMins  = activities.reduce((s, a) => s + a.duration_mins, 0);
    const top        = this.topCategory(activities);

    return {
      date:             start.toISOString().slice(0, 10),
      blocks:           blocks.sort((a, b) => a.activity.started_at.localeCompare(b.activity.started_at)),
      total_active_mins: totalMins,
      top_category:     top,
    };
  }

  /**
   * reconstructRange() — timeline for each day in a date range.
   * Skips days with no activities.
   */
  async reconstructRange(userId: string, from: Date, to: Date): Promise<DayTimeline[]> {
    const activities = await this.repo.listInRange(userId, from, to);
    const byDay = new Map<string, Activity[]>();

    for (const a of activities) {
      const day = a.started_at.slice(0, 10);
      if (!byDay.has(day)) byDay.set(day, []);
      byDay.get(day)!.push(a);
    }

    return Array.from(byDay.entries())
      .map(([date, acts]) => ({
        date,
        blocks:            acts.map(a => this.toBlock(a)).sort((a, b) => a.activity.started_at.localeCompare(b.activity.started_at)),
        total_active_mins: acts.reduce((s, a) => s + a.duration_mins, 0),
        top_category:      this.topCategory(acts),
      }))
      .sort((a, b) => b.date.localeCompare(a.date));
  }

  // ---- Private --------------------------------------------

  private toBlock(activity: Activity): TimeBlock {
    const start = this.fmtTime(new Date(activity.started_at));
    const end   = this.fmtTime(new Date(activity.ended_at));
    return {
      activity,
      observation_ids: [],       // populated by service when join table is queried
      label: `${start}–${end} · ${activity.title}`,
    };
  }

  private fmtTime(d: Date): string {
    return d.toISOString().slice(11, 16);  // HH:MM
  }

  private topCategory(activities: Activity[]): ObservationCategory {
    const counts: Record<string, number> = {};
    for (const a of activities) {
      counts[a.category] = (counts[a.category] ?? 0) + a.duration_mins;
    }
    return (Object.entries(counts).sort(([, a], [, b]) => b - a)[0]?.[0] ?? 'PERSONAL') as ObservationCategory;
  }
}
