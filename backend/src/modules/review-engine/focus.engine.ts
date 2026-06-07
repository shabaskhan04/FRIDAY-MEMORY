// ============================================================
// focus.engine.ts — Where is attention going vs. where it should
// ============================================================
import type { EntityContext, FocusArea, FocusVerdict } from './review.types';
import { computeFocusAndResult } from './review-scoring';

export class FocusEngine {

  /** Classify all entities into focus areas with mismatch analysis */
  getFocusAreas(entities: EntityContext[]): FocusArea[] {
    return entities
      .map(entity => {
        const { focus_score, result_score } = computeFocusAndResult(entity);
        const mismatch_delta = focus_score - result_score;
        return {
          entity,
          focus_score,
          result_score,
          verdict:        this.classify(focus_score, result_score),
          mismatch_delta,
        };
      })
      .sort((a, b) => b.focus_score - a.focus_score);
  }

  /**
   * getOverinvestedAreas() — high attention, low result.
   * "What is consuming attention without producing results?"
   */
  getOverinvestedAreas(entities: EntityContext[]): FocusArea[] {
    return this.getFocusAreas(entities)
      .filter(f => f.verdict === 'HIGH_FOCUS_LOW_RESULT')
      .sort((a, b) => b.mismatch_delta - a.mismatch_delta);
  }

  /**
   * getNeglectedAreas() — low attention, high opportunity (goal alignment / importance).
   * "What should I be focusing on that I'm ignoring?"
   */
  getNeglectedAreas(entities: EntityContext[]): FocusArea[] {
    return this.getFocusAreas(entities)
      .filter(f => f.verdict === 'LOW_FOCUS_HIGH_OPPORTUNITY')
      .sort((a, b) => b.result_score - a.result_score);
  }

  /**
   * getAttentionMismatch() — all entities sorted by |mismatch_delta|.
   * Reveals the biggest gaps between effort and output.
   */
  getAttentionMismatch(entities: EntityContext[]): FocusArea[] {
    return this.getFocusAreas(entities)
      .filter(f => f.verdict !== 'BALANCED' && f.verdict !== 'HIGH_FOCUS_HIGH_RESULT')
      .sort((a, b) => Math.abs(b.mismatch_delta) - Math.abs(a.mismatch_delta));
  }

  // ---- Private -------------------------------------------

  private classify(focus: number, result: number): FocusVerdict {
    const HIGH = 0.55;
    const LOW  = 0.45;
    const hi_f = focus  >= HIGH;
    const lo_f = focus  <= LOW;
    const hi_r = result >= HIGH;
    const lo_r = result <= LOW;

    if (hi_f && hi_r) return 'HIGH_FOCUS_HIGH_RESULT';
    if (hi_f && lo_r) return 'HIGH_FOCUS_LOW_RESULT';
    if (lo_f && hi_r) return 'LOW_FOCUS_HIGH_OPPORTUNITY';
    if (lo_f && lo_r) return 'LOW_FOCUS_LOW_RESULT';
    return 'BALANCED';
  }
}
