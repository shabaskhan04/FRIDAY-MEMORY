// ============================================================
// activity.repository.ts
// ============================================================
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Activity, CreateActivityInput } from './activity.types';

export class ActivityRepository {
  constructor(private readonly db: SupabaseClient) {}

  async create(input: CreateActivityInput): Promise<Activity> {
    const { data, error } = await this.db
      .from('activities').insert(input).select().single();
    if (error) throw error;
    return data;
  }

  async createMany(inputs: CreateActivityInput[]): Promise<Activity[]> {
    const { data, error } = await this.db
      .from('activities').insert(inputs).select();
    if (error) throw error;
    return data ?? [];
  }

  async getById(id: string, userId: string): Promise<Activity | null> {
    const { data, error } = await this.db
      .from('activities').select()
      .eq('id', id).eq('user_id', userId).maybeSingle();
    if (error) throw error;
    return data;
  }

  async listInRange(userId: string, from: Date, to: Date): Promise<Activity[]> {
    const { data, error } = await this.db
      .from('activities').select()
      .eq('user_id', userId)
      .gte('started_at', from.toISOString())
      .lte('started_at', to.toISOString())
      .order('started_at', { ascending: true });
    if (error) throw error;
    return data ?? [];
  }

  async listByCategory(userId: string, category: string, limit = 50): Promise<Activity[]> {
    const { data, error } = await this.db
      .from('activities').select()
      .eq('user_id', userId).eq('category', category)
      .order('started_at', { ascending: false }).limit(limit);
    if (error) throw error;
    return data ?? [];
  }

  async listRecent(userId: string, limit = 50): Promise<Activity[]> {
    const { data, error } = await this.db
      .from('activities').select()
      .eq('user_id', userId)
      .order('started_at', { ascending: false }).limit(limit);
    if (error) throw error;
    return data ?? [];
  }

  async linkObservations(activityId: string, observationIds: string[]): Promise<void> {
    if (!observationIds.length) return;
    const rows = observationIds.map(oid => ({ activity_id: activityId, observation_id: oid }));
    const { error } = await this.db.from('activity_observations').insert(rows);
    if (error) throw error;
  }

  async getObservationIds(activityId: string): Promise<string[]> {
    const { data, error } = await this.db
      .from('activity_observations').select('observation_id')
      .eq('activity_id', activityId);
    if (error) throw error;
    return (data ?? []).map((r: any) => r.observation_id);
  }

  async sumMinsByCategory(userId: string, from: Date, to: Date): Promise<Record<string, number>> {
    const activities = await this.listInRange(userId, from, to);
    const result: Record<string, number> = {};
    for (const a of activities) {
      result[a.category] = (result[a.category] ?? 0) + a.duration_mins;
    }
    return result;
  }
}
