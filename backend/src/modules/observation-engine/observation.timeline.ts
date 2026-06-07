// ============================================================
// observation.timeline.ts — Temporal grouping of observations
// ============================================================
import type { ObservationRepository } from './observation.repository';
import type { Observation } from './observation.types';

export interface TimelineBucket {
  date: string;           // ISO date or YYYY-MM depending on granularity
  count: number;
  observations: Array<Pick<Observation, 'id' | 'title' | 'source' | 'importance_score' | 'occurred_at'>>;
}

export class ObservationTimeline {
  constructor(private readonly repo: ObservationRepository) {}

  /**
   * getTimeline() — group observations into day/week/month buckets.
   * Returns most recent bucket first.
   */
  async getTimeline(
    userId: string,
    from: Date,
    to: Date,
    granularity: 'day' | 'week' | 'month' = 'day',
  ): Promise<TimelineBucket[]> {
    const observations = await this.repo.listInRange(userId, from, to);
    const buckets = new Map<string, TimelineBucket>();

    for (const obs of observations) {
      const key = this.bucketKey(new Date(obs.occurred_at), granularity);
      if (!buckets.has(key)) buckets.set(key, { date: key, count: 0, observations: [] });
      const b = buckets.get(key)!;
      b.count++;
      b.observations.push({ id: obs.id, title: obs.title, source: obs.source, importance_score: obs.importance_score, occurred_at: obs.occurred_at });
    }

    return Array.from(buckets.values()).sort((a, b) => b.date.localeCompare(a.date));
  }

  /**
   * getTopObservationDays() — days with highest observation count.
   * Reveals high-activity periods.
   */
  async getTopObservationDays(userId: string, lookbackDays = 30, topN = 5): Promise<TimelineBucket[]> {
    const from = new Date(Date.now() - lookbackDays * 86_400_000);
    const to   = new Date();
    const timeline = await this.getTimeline(userId, from, to, 'day');
    return timeline.sort((a, b) => b.count - a.count).slice(0, topN);
  }

  private bucketKey(date: Date, granularity: 'day' | 'week' | 'month'): string {
    if (granularity === 'month') return date.toISOString().slice(0, 7);
    if (granularity === 'week') {
      // ISO week start (Monday)
      const d = new Date(date);
      d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
      return d.toISOString().slice(0, 10);
    }
    return date.toISOString().slice(0, 10);
  }
}
