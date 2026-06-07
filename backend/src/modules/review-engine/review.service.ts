// ============================================================
// review.service.ts — generateStrategicReview() orchestration
// ============================================================
import type { SupabaseClient }        from '@supabase/supabase-js';
import type { FocusEngine }           from './focus.engine';
import type { RiskEngine }            from './risk.engine';
import type { PriorityEngine }        from './priority.engine';
import type { RecommendationEngine }  from './recommendation.engine';
import type {
  ReviewContext, StrategicReview, StoredReview,
} from './review.types';
import { overallScore } from './review-scoring';

export class ReviewService {
  constructor(
    private readonly db:             SupabaseClient,
    private readonly focusEngine:    FocusEngine,
    private readonly riskEngine:     RiskEngine,
    private readonly priorityEngine: PriorityEngine,
    private readonly recEngine:      RecommendationEngine,
  ) {}

  // ---- Core -------------------------------------------

  async generateStrategicReview(ctx: ReviewContext, trigger = 'manual'): Promise<StrategicReview> {
    const { entities } = ctx;

    // Run all engines (pure computation — no I/O)
    const focusAreas   = this.focusEngine.getFocusAreas(entities);
    const risks        = this.riskEngine.detectRisks(entities);
    const priorities   = this.priorityEngine.calculatePriority(entities);
    const recs         = this.recEngine.generateRecommendations(entities, focusAreas, risks, priorities);

    const neglectedGoals   = entities.filter(e => e.node_type === 'GOAL' && e.days_since_last_mention > 14);
    const underperforming  = this.focusEngine.getOverinvestedAreas(entities);
    const opportunities    = this.priorityEngine.topOpportunities(entities);
    const emerging         = this.priorityEngine.emergingProjects(entities);

    const topPriorities    = priorities.slice(0, 5);
    const avgPriority      = avg(topPriorities.map(p => p.priority_score));
    const avgAlignment     = avg(entities.map(e => e.goal_alignment_score));
    const avgRisk          = avg(risks.map(r => r.risk_score));
    const confidence       = avg(recs.map(r => r.confidence));

    const review: StrategicReview = {
      user_id:            ctx.user_id,
      period_start:       ctx.period_start.toISOString(),
      period_end:         ctx.period_end.toISOString(),
      generated_at:       new Date().toISOString(),
      current_focus:      focusAreas.slice(0, 10),
      top_opportunities:  opportunities,
      top_risks:          risks.slice(0, 5),
      neglected_goals:    neglectedGoals,
      underperforming,
      emerging_projects:  emerging,
      priorities:         priorities.slice(0, 10),
      recommendations:    recs,
      overall_score:      overallScore(avgPriority, avgAlignment, avgRisk),
      confidence,
    };

    await this.store(ctx.user_id, trigger, ctx.period_start, ctx.period_end, review);
    return review;
  }

  // ---- Storage ----------------------------------------

  private async store(
    userId: string,
    trigger: string,
    start: Date,
    end: Date,
    review: StrategicReview,
  ): Promise<void> {
    const { error } = await this.db.from('strategic_reviews').insert({
      user_id:       userId,
      period_start:  start.toISOString(),
      period_end:    end.toISOString(),
      trigger,
      summary:       review,
      overall_score: review.overall_score,
      confidence:    review.confidence,
    });
    if (error) throw error;
  }

  async getLatestReview(userId: string): Promise<StoredReview | null> {
    const { data, error } = await this.db
      .from('strategic_reviews').select()
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1).maybeSingle();
    if (error) throw error;
    return data;
  }

  async getReviewHistory(userId: string, limit = 10): Promise<StoredReview[]> {
    const { data, error } = await this.db
      .from('strategic_reviews').select()
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data ?? [];
  }
}

function avg(values: number[]): number {
  return values.length ? values.reduce((s, v) => s + v, 0) / values.length : 0;
}
