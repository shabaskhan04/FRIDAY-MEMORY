// ============================================================
// observation-insights.ts — Behavioral pattern analytics
// ============================================================
import type { ObservationRepository } from './observation.repository';
import type {
  Observation, ObservationSource, ObservationCategory,
  ObservationDistribution, SourceSummary, ActivityTrend, AttentionDrift,
} from './observation.types';

export class ObservationInsights {
  constructor(private readonly repo: ObservationRepository) {}

  // ---- getObservationDistribution() -----------------------
  // Counts by source and category over a time window.

  async getObservationDistribution(
    userId: string,
    days = 30,
  ): Promise<ObservationDistribution> {
    const from = new Date(Date.now() - days * 86_400_000);
    const [by_source, by_category] = await Promise.all([
      this.repo.countBySourceInRange(userId, from, new Date()),
      this.repo.countByCategoryInRange(userId, from, new Date()),
    ]);
    const total = Object.values(by_source).reduce((s, v) => s + v, 0);
    return { by_source, by_category, total, period_days: days };
  }

  // ---- getTopObservationSources() -------------------------

  async getTopObservationSources(userId: string, days = 30, topN = 10): Promise<SourceSummary[]> {
    const from = new Date(Date.now() - days * 86_400_000);
    const observations = await this.repo.listInRange(userId, from, new Date(), 1000);

    const map = new Map<ObservationSource, { count: number; totalImportance: number }>();
    for (const o of observations) {
      const entry = map.get(o.source) ?? { count: 0, totalImportance: 0 };
      entry.count++;
      entry.totalImportance += o.importance_score;
      map.set(o.source, entry);
    }

    return Array.from(map.entries())
      .map(([source, s]) => ({
        source,
        count: s.count,
        avg_importance: s.totalImportance / s.count,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, topN);
  }

  // ---- getAttentionDrift() --------------------------------
  // Compare category distribution in two consecutive half-periods.
  // Reveals which areas are gaining/losing attention.

  async getAttentionDrift(userId: string, days = 60): Promise<AttentionDrift> {
    const now  = new Date();
    const mid  = new Date(now.getTime() - (days / 2) * 86_400_000);
    const from = new Date(now.getTime() - days * 86_400_000);

    const [before, after] = await Promise.all([
      this.repo.countByCategoryInRange(userId, from, mid),
      this.repo.countByCategoryInRange(userId, mid, now),
    ]);

    const allCategories = new Set([...Object.keys(before), ...Object.keys(after)]) as Set<ObservationCategory>;
    const shifts: AttentionDrift['shifts'] = [];

    for (const cat of allCategories) {
      const b = before[cat] ?? 0;
      const a = after[cat]  ?? 0;
      if (b + a === 0) continue;
      const delta_pct = b === 0 ? 100 : Math.round(((a - b) / b) * 100);
      shifts.push({ category: cat, delta_pct });
    }

    shifts.sort((a, b) => Math.abs(b.delta_pct) - Math.abs(a.delta_pct));

    return {
      from_date: from.toISOString(),
      to_date:   now.toISOString(),
      gained: shifts.filter(s => s.delta_pct > 10).map(s => s.category),
      lost:   shifts.filter(s => s.delta_pct < -10).map(s => s.category),
      shifts,
    };
  }

  // ---- getEmergingActivities() ----------------------------
  // Sources with count > 0 in recent half but 0 in older half.

  async getEmergingActivities(userId: string, days = 60): Promise<ActivityTrend[]> {
    return (await this.getTrends(userId, days)).filter(t => t.direction === 'RISING');
  }

  // ---- getDecliningActivities() ---------------------------

  async getDecliningActivities(userId: string, days = 60): Promise<ActivityTrend[]> {
    return (await this.getTrends(userId, days)).filter(t => t.direction === 'DECLINING');
  }

  // ---- getObservationTrends() -----------------------------

  async getObservationTrends(userId: string, days = 60): Promise<ActivityTrend[]> {
    return this.getTrends(userId, days);
  }

  // ---- Private helper -------------------------------------

  private async getTrends(userId: string, days: number): Promise<ActivityTrend[]> {
    const now  = new Date();
    const mid  = new Date(now.getTime() - (days / 2) * 86_400_000);
    const from = new Date(now.getTime() - days * 86_400_000);

    const [before, after] = await Promise.all([
      this.repo.countBySourceInRange(userId, from, mid),
      this.repo.countBySourceInRange(userId, mid, now),
    ]);

    const sources = new Set([...Object.keys(before), ...Object.keys(after)]) as Set<ObservationSource>;
    const trends: ActivityTrend[] = [];

    for (const source of sources) {
      const b = before[source] ?? 0;
      const a = after[source]  ?? 0;
      const delta_pct = b === 0 ? 100 : Math.round(((a - b) / b) * 100);
      const direction: ActivityTrend['direction'] =
        delta_pct > 20 ? 'RISING' :
        delta_pct < -20 ? 'DECLINING' :
        'STABLE';

      trends.push({
        source,
        category: 'WORK',  // filled in by caller if needed
        label:    source.replace(/_/g, ' ').toLowerCase(),
        direction,
        delta_pct,
      });
    }

    return trends.sort((a, b) => Math.abs(b.delta_pct) - Math.abs(a.delta_pct));
  }
}
