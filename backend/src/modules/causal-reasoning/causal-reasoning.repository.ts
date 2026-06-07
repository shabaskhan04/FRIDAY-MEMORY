// ============================================================
// causal-reasoning.repository.ts
// ============================================================
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  CausalPattern, CausalEvidence, CausalPrediction,
  PatternType, PatternStatus,
} from './causal-reasoning.types';

export class CausalReasoningRepository {
  constructor(private readonly db: SupabaseClient) {}

  // ---- Patterns --------------------------------------------

  async upsertPattern(p: Omit<CausalPattern, 'id' | 'created_at'>): Promise<CausalPattern> {
    const { data: existing } = await this.db.from('causal_patterns').select()
      .eq('user_id', p.user_id).eq('cause_label', p.cause_label)
      .eq('effect_label', p.effect_label).eq('pattern_type', p.pattern_type)
      .maybeSingle();

    if (existing) {
      const { data, error } = await this.db.from('causal_patterns').update({
        occurrence_count: existing.occurrence_count + 1,
        confidence:       Math.min(0.99, existing.confidence + 0.02),
        last_seen_at:     new Date().toISOString(),
        status:           existing.occurrence_count + 1 >= 3 ? 'CONFIRMED' : existing.status,
      }).eq('id', existing.id).select().single();
      if (error) throw error;
      return data;
    }

    const { data, error } = await this.db.from('causal_patterns').insert({
      ...p, occurrence_count: p.occurrence_count ?? 1,
    }).select().single();
    if (error) throw error;
    return data;
  }

  async getPatterns(userId: string, type?: PatternType): Promise<CausalPattern[]> {
    let q = this.db.from('causal_patterns').select()
      .eq('user_id', userId).neq('status', 'REJECTED');
    if (type) q = q.eq('pattern_type', type);
    const { data, error } = await q.order('confidence', { ascending: false }).limit(50);
    if (error) throw error;
    return data ?? [];
  }

  async rejectPattern(id: string, userId: string): Promise<void> {
    const { error } = await this.db.from('causal_patterns')
      .update({ status: 'REJECTED' }).eq('id', id).eq('user_id', userId);
    if (error) throw error;
  }

  // ---- Evidence --------------------------------------------

  async addEvidence(e: Omit<CausalEvidence, 'id' | 'created_at'>): Promise<CausalEvidence> {
    const { data, error } = await this.db.from('causal_evidence').insert(e).select().single();
    if (error) throw error;
    return data;
  }

  async getEvidence(patternId: string): Promise<CausalEvidence[]> {
    const { data, error } = await this.db.from('causal_evidence')
      .select().eq('pattern_id', patternId).order('observed_at', { ascending: false }).limit(20);
    if (error) throw error;
    return data ?? [];
  }

  // ---- Predictions -----------------------------------------

  async savePrediction(p: Omit<CausalPrediction, 'id' | 'created_at'>): Promise<CausalPrediction> {
    const { data, error } = await this.db.from('causal_predictions').insert(p).select().single();
    if (error) throw error;
    return data;
  }

  async getPredictions(userId: string): Promise<CausalPrediction[]> {
    const { data, error } = await this.db.from('causal_predictions')
      .select().eq('user_id', userId).order('created_at', { ascending: false }).limit(20);
    if (error) throw error;
    return data ?? [];
  }
}
