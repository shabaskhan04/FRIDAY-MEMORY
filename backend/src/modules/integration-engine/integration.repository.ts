// ============================================================
// integration.repository.ts — Supabase persistence
// ============================================================
import type { SupabaseClient } from '@supabase/supabase-js';
import type { PipelineRun, PipelineStage, WorkflowType, PipelineStatus } from './integration.types';

export class IntegrationRepository {
  constructor(private readonly db: SupabaseClient) {}

  // ---- Runs -----------------------------------------------

  async createRun(input: Omit<PipelineRun, 'id' | 'completed_at' | 'duration_ms' | 'started_at'>): Promise<PipelineRun> {
    const { data, error } = await this.db.from('pipeline_runs').insert(input).select().single();
    if (error) throw error;
    return data;
  }

  async updateRun(id: string, patch: Partial<PipelineRun>): Promise<void> {
    const { error } = await this.db.from('pipeline_runs').update(patch).eq('id', id);
    if (error) throw error;
  }

  async getRunById(id: string): Promise<PipelineRun | null> {
    const { data, error } = await this.db.from('pipeline_runs').select().eq('id', id).maybeSingle();
    if (error) throw error;
    return data;
  }

  async listRuns(userId: string, limit = 50): Promise<PipelineRun[]> {
    const { data, error } = await this.db
      .from('pipeline_runs').select().eq('user_id', userId)
      .order('started_at', { ascending: false }).limit(limit);
    if (error) throw error;
    return data ?? [];
  }

  async listRunsByWorkflow(userId: string, workflow: WorkflowType, limit = 50): Promise<PipelineRun[]> {
    const { data, error } = await this.db
      .from('pipeline_runs').select()
      .eq('user_id', userId).eq('workflow_type', workflow)
      .order('started_at', { ascending: false }).limit(limit);
    if (error) throw error;
    return data ?? [];
  }

  async listRunsByStatus(userId: string, status: PipelineStatus, limit = 50): Promise<PipelineRun[]> {
    const { data, error } = await this.db
      .from('pipeline_runs').select()
      .eq('user_id', userId).eq('status', status)
      .order('started_at', { ascending: false }).limit(limit);
    if (error) throw error;
    return data ?? [];
  }

  // ---- Stages ---------------------------------------------

  async createStage(input: Omit<PipelineStage, 'id' | 'started_at' | 'completed_at' | 'duration_ms' | 'error' | 'metadata'>): Promise<PipelineStage> {
    const { data, error } = await this.db.from('pipeline_stages').insert(input).select().single();
    if (error) throw error;
    return data;
  }

  async updateStage(id: string, patch: Partial<PipelineStage>): Promise<void> {
    const { error } = await this.db.from('pipeline_stages').update(patch).eq('id', id);
    if (error) throw error;
  }

  async getStagesByRun(runId: string): Promise<PipelineStage[]> {
    const { data, error } = await this.db
      .from('pipeline_stages').select().eq('pipeline_run_id', runId)
      .order('started_at', { ascending: true });
    if (error) throw error;
    return data ?? [];
  }

  async getFailedStages(userId: string, limit = 100): Promise<PipelineStage[]> {
    const { data, error } = await this.db
      .from('pipeline_stages')
      .select('pipeline_stages.*, pipeline_runs!inner(user_id)')
      .eq('pipeline_runs.user_id', userId)
      .eq('status', 'FAILED')
      .order('pipeline_stages.started_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data as any[] ?? []) as PipelineStage[];
  }
}
