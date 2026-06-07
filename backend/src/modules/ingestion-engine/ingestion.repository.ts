// ============================================================
// ingestion.repository.ts
// ============================================================
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  IngestionSource, IngestionRun, IngestionEvent, IngestionFailure,
  CreateSourceInput, SyncStatus, RunStatus, EventStatus,
} from './ingestion.types';

export class IngestionRepository {
  constructor(private readonly db: SupabaseClient) {}

  async createSource(userId: string, input: CreateSourceInput): Promise<IngestionSource> {
    const { data, error } = await this.db.from('ingestion_sources').insert({
      user_id:    userId,
      source_type: input.source_type,
      name:        input.name,
      config:      input.config ?? {},
      enabled:     input.enabled ?? true,
      sync_status: 'IDLE',
      health_score: 1.0,
      consecutive_failures: 0,
    }).select().single();
    if (error) throw error;
    return data;
  }

  async getSource(id: string, userId: string): Promise<IngestionSource | null> {
    const { data, error } = await this.db.from('ingestion_sources')
      .select().eq('id', id).eq('user_id', userId).maybeSingle();
    if (error) throw error;
    return data;
  }

  async listSources(userId: string): Promise<IngestionSource[]> {
    const { data, error } = await this.db.from('ingestion_sources')
      .select().eq('user_id', userId).order('created_at', { ascending: false });
    if (error) throw error;
    return data ?? [];
  }

  async updateSource(id: string, userId: string, patch: Partial<IngestionSource>): Promise<IngestionSource> {
    const { data, error } = await this.db.from('ingestion_sources')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', id).eq('user_id', userId).select().single();
    if (error) throw error;
    return data;
  }

  async createRun(sourceId: string, userId: string): Promise<IngestionRun> {
    const { data, error } = await this.db.from('ingestion_runs').insert({
      source_id:        sourceId,
      user_id:          userId,
      started_at:       new Date().toISOString(),
      status:           'RUNNING',
      records_fetched:  0,
      records_ingested: 0,
      records_skipped:  0,
      records_failed:   0,
    }).select().single();
    if (error) throw error;
    return data;
  }

  async updateRun(id: string, patch: Partial<IngestionRun>): Promise<IngestionRun> {
    const { data, error } = await this.db.from('ingestion_runs')
      .update(patch).eq('id', id).select().single();
    if (error) throw error;
    return data;
  }

  async getRunHistory(sourceId: string, userId: string, limit = 20): Promise<IngestionRun[]> {
    const { data, error } = await this.db.from('ingestion_runs')
      .select().eq('source_id', sourceId).eq('user_id', userId)
      .order('started_at', { ascending: false }).limit(limit);
    if (error) throw error;
    return data ?? [];
  }

  async saveEvent(event: Omit<IngestionEvent, 'id' | 'created_at'>): Promise<IngestionEvent> {
    const { data, error } = await this.db.from('ingestion_events').insert(event).select().single();
    if (error) throw error;
    return data;
  }

  async isDuplicate(userId: string, externalId: string | null, contentHash: string): Promise<boolean> {
    const query = this.db.from('ingestion_events').select('id').eq('user_id', userId).limit(1);
    if (externalId) {
      const { data } = await query.eq('external_id', externalId);
      if (data?.length) return true;
    }
    const { data } = await this.db.from('ingestion_events').select('id')
      .eq('user_id', userId).eq('content_hash', contentHash).limit(1);
    return !!(data?.length);
  }

  async saveFailure(f: Omit<IngestionFailure, 'id' | 'created_at'>): Promise<IngestionFailure> {
    const { data, error } = await this.db.from('ingestion_failures').insert(f).select().single();
    if (error) throw error;
    return data;
  }

  async getPendingRetries(userId: string): Promise<IngestionFailure[]> {
    const { data, error } = await this.db.from('ingestion_failures').select()
      .eq('user_id', userId).eq('is_dead_letter', false)
      .lte('next_retry_at', new Date().toISOString())
      .order('next_retry_at', { ascending: true });
    if (error) throw error;
    return data ?? [];
  }

  async updateFailure(id: string, patch: Partial<IngestionFailure>): Promise<void> {
    const { error } = await this.db.from('ingestion_failures').update(patch).eq('id', id);
    if (error) throw error;
  }

  async getSourceHealth(userId: string): Promise<IngestionSource[]> {
    const { data, error } = await this.db.from('ingestion_sources')
      .select().eq('user_id', userId).order('health_score', { ascending: true });
    if (error) throw error;
    return data ?? [];
  }
}
