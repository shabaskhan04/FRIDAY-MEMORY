// ============================================================
// decision.timeline.ts — Temporal view of decisions
// ============================================================
import type { DecisionRepository } from './decision.repository';
import type { DecisionTimeline } from './decision.types';

export class DecisionTimelineService {
  constructor(private readonly repo: DecisionRepository) {}

  /**
   * getTimeline() — group decisions by date bucket (day or month).
   * Useful for: "Show me how my decisions evolved over Q1."
   */
  async getTimeline(
    userId: string,
    granularity: 'day' | 'month' = 'month',
  ): Promise<DecisionTimeline[]> {
    const decisions = await this.repo.listByUser(userId, { limit: 500 });

    const buckets = new Map<string, DecisionTimeline['decisions']>();

    for (const d of decisions) {
      const date = new Date(d.decision_date);
      const key  = granularity === 'day'
        ? date.toISOString().slice(0, 10)
        : date.toISOString().slice(0, 7);

      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key)!.push({
        id:               d.id,
        title:            d.title,
        status:           d.status,
        confidence_score: d.confidence_score,
      });
    }

    return Array.from(buckets.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, decisions]) => ({ date, decisions }));
  }

  /**
   * getDecisionsInRange() — decisions made between two dates.
   */
  async getDecisionsInRange(
    userId: string,
    from: Date,
    to: Date,
  ): Promise<DecisionTimeline[]> {
    const all = await this.repo.listByUser(userId, { limit: 500 });
    const inRange = all.filter(d => {
      const t = new Date(d.decision_date).getTime();
      return t >= from.getTime() && t <= to.getTime();
    });

    const buckets = new Map<string, DecisionTimeline['decisions']>();
    for (const d of inRange) {
      const key = new Date(d.decision_date).toISOString().slice(0, 7);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key)!.push({ id: d.id, title: d.title, status: d.status, confidence_score: d.confidence_score });
    }

    return Array.from(buckets.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, decisions]) => ({ date, decisions }));
  }
}
