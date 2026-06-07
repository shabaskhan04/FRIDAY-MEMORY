// ============================================================
// observation.repository.ts
// ============================================================
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Observation, CreateObservationInput, ObservationSource, ObservationCategory } from './observation.types';

export class ObservationRepository {
  constructor(private readonly db: SupabaseClient) {}

  async create(input: CreateObservationInput): Promise<Observation> {
    const { data, error } = await this.db
      .from('observations').insert(input).select().single();
    if (error) throw error;
    return data;
  }

  async getById(id: string, userId: string): Promise<Observation | null> {
    const { data, error } = await this.db
      .from('observations').select()
      .eq('id', id).eq('user_id', userId).maybeSingle();
    if (error) throw error;
    return data;
  }

  async update(id: string, userId: string, patch: Partial<Observation>): Promise<Observation> {
    const { data, error } = await this.db
      .from('observations').update(patch)
      .eq('id', id).eq('user_id', userId).select().single();
    if (error) throw error;
    return data;
  }

  async listRecent(userId: string, limit = 100): Promise<Observation[]> {
    const { data, error } = await this.db
      .from('observations').select()
      .eq('user_id', userId)
      .order('occurred_at', { ascending: false }).limit(limit);
    if (error) throw error;
    return data ?? [];
  }

  async listBySource(userId: string, source: ObservationSource, limit = 100): Promise<Observation[]> {
    const { data, error } = await this.db
      .from('observations').select()
      .eq('user_id', userId).eq('source', source)
      .order('occurred_at', { ascending: false }).limit(limit);
    if (error) throw error;
    return data ?? [];
  }

  async listByCategory(userId: string, category: ObservationCategory, limit = 100): Promise<Observation[]> {
    const { data, error } = await this.db
      .from('observations').select()
      .eq('user_id', userId)
      .contains('categories', [category])
      .order('occurred_at', { ascending: false }).limit(limit);
    if (error) throw error;
    return data ?? [];
  }

  async listInRange(userId: string, from: Date, to: Date, limit = 500): Promise<Observation[]> {
    const { data, error } = await this.db
      .from('observations').select()
      .eq('user_id', userId)
      .gte('occurred_at', from.toISOString())
      .lte('occurred_at', to.toISOString())
      .order('occurred_at', { ascending: false }).limit(limit);
    if (error) throw error;
    return data ?? [];
  }

  async listUnprocessed(userId: string, limit = 50): Promise<Observation[]> {
    const { data, error } = await this.db
      .from('observations').select()
      .eq('user_id', userId).eq('is_processed', false)
      .order('occurred_at', { ascending: true }).limit(limit);
    if (error) throw error;
    return data ?? [];
  }

  async markProcessed(id: string, userId: string): Promise<void> {
    const { error } = await this.db
      .from('observations').update({ is_processed: true })
      .eq('id', id).eq('user_id', userId);
    if (error) throw error;
  }

  async countBySourceInRange(userId: string, from: Date, to: Date): Promise<Record<string, number>> {
    const { data, error } = await this.db
      .from('observations').select('source')
      .eq('user_id', userId)
      .gte('occurred_at', from.toISOString())
      .lte('occurred_at', to.toISOString());
    if (error) throw error;
    const counts: Record<string, number> = {};
    for (const row of data ?? []) {
      counts[row.source] = (counts[row.source] ?? 0) + 1;
    }
    return counts;
  }

  async countByCategoryInRange(userId: string, from: Date, to: Date): Promise<Record<string, number>> {
    const obs = await this.listInRange(userId, from, to);
    const counts: Record<string, number> = {};
    for (const o of obs) {
      for (const cat of o.categories) {
        counts[cat] = (counts[cat] ?? 0) + 1;
      }
    }
    return counts;
  }
}
