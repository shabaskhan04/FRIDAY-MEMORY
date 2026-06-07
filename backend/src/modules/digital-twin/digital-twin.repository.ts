// ============================================================
// digital-twin.repository.ts
// ============================================================
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  DigitalTwinProfile, DigitalTwinTrait, DigitalTwinPrediction,
  TraitCategory, PredictionType,
} from './digital-twin.types';

export class DigitalTwinRepository {
  constructor(private readonly db: SupabaseClient) {}

  // ---- Profile ---------------------------------------------

  async getProfile(userId: string): Promise<DigitalTwinProfile | null> {
    const { data, error } = await this.db.from('digital_twin_profiles')
      .select().eq('user_id', userId).order('version', { ascending: false }).limit(1).maybeSingle();
    if (error) throw error;
    return data;
  }

  async upsertProfile(userId: string, patch: Partial<DigitalTwinProfile>): Promise<DigitalTwinProfile> {
    const existing = await this.getProfile(userId);
    if (existing) {
      const { data, error } = await this.db.from('digital_twin_profiles')
        .update({ ...patch, updated_at: new Date().toISOString(), version: existing.version + 1 })
        .eq('id', existing.id).select().single();
      if (error) throw error;
      return data;
    }
    const { data, error } = await this.db.from('digital_twin_profiles')
      .insert({ user_id: userId, version: 1, ...patch }).select().single();
    if (error) throw error;
    return data;
  }

  // ---- Traits ----------------------------------------------

  async getTraits(userId: string): Promise<DigitalTwinTrait[]> {
    const { data, error } = await this.db.from('digital_twin_traits')
      .select().eq('user_id', userId).order('confidence', { ascending: false });
    if (error) throw error;
    return data ?? [];
  }

  async upsertTrait(userId: string, profileId: string, trait: Omit<DigitalTwinTrait, 'id' | 'user_id' | 'profile_id' | 'first_seen_at' | 'last_seen_at'>): Promise<DigitalTwinTrait> {
    const { data: existing } = await this.db.from('digital_twin_traits').select()
      .eq('user_id', userId).eq('category', trait.category).eq('trait_name', trait.trait_name).maybeSingle();

    if (existing) {
      const { data, error } = await this.db.from('digital_twin_traits').update({
        trait_value: trait.trait_value,
        confidence: Math.max(existing.confidence, trait.confidence),
        evidence_count: existing.evidence_count + 1,
        last_seen_at: new Date().toISOString(),
      }).eq('id', existing.id).select().single();
      if (error) throw error;
      return data;
    }

    const { data, error } = await this.db.from('digital_twin_traits').insert({
      user_id: userId, profile_id: profileId, ...trait,
      first_seen_at: new Date().toISOString(), last_seen_at: new Date().toISOString(),
    }).select().single();
    if (error) throw error;
    return data;
  }

  // ---- Predictions -----------------------------------------

  async savePrediction(userId: string, profileId: string, p: Omit<DigitalTwinPrediction, 'id' | 'user_id' | 'profile_id' | 'created_at'>): Promise<DigitalTwinPrediction> {
    const { data, error } = await this.db.from('digital_twin_predictions').insert({
      user_id: userId, profile_id: profileId, ...p,
    }).select().single();
    if (error) throw error;
    return data;
  }

  async getPredictions(userId: string, type?: PredictionType): Promise<DigitalTwinPrediction[]> {
    let q = this.db.from('digital_twin_predictions').select().eq('user_id', userId);
    if (type) q = q.eq('prediction_type', type);
    const { data, error } = await q.order('created_at', { ascending: false }).limit(20);
    if (error) throw error;
    return data ?? [];
  }
}
