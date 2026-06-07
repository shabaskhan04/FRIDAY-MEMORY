// ============================================================
// decision.repository.ts — Supabase data access
// ============================================================
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  Decision, DecisionEntity, DecisionEvaluation,
  CreateDecisionInput, UpdateDecisionInput, EvaluateDecisionInput,
  DecisionRelationshipType,
} from './decision.types';

export class DecisionRepository {
  constructor(private readonly db: SupabaseClient) {}

  // ---- Decisions -------------------------------------------

  async create(input: CreateDecisionInput): Promise<Decision> {
    const { data, error } = await this.db
      .from('decisions').insert(input).select().single();
    if (error) throw error;
    return data;
  }

  async getById(id: string, userId: string): Promise<Decision | null> {
    const { data, error } = await this.db
      .from('decisions').select()
      .eq('id', id).eq('user_id', userId).maybeSingle();
    if (error) throw error;
    return data;
  }

  async update(id: string, userId: string, input: UpdateDecisionInput): Promise<Decision> {
    const { data, error } = await this.db
      .from('decisions').update(input)
      .eq('id', id).eq('user_id', userId).select().single();
    if (error) throw error;
    return data;
  }

  async listByUser(
    userId: string,
    filters: { status?: string; decision_type?: string; limit?: number } = {},
  ): Promise<Decision[]> {
    let q = this.db.from('decisions').select()
      .eq('user_id', userId)
      .order('decision_date', { ascending: false })
      .limit(filters.limit ?? 100);
    if (filters.status)        q = q.eq('status', filters.status);
    if (filters.decision_type) q = q.eq('decision_type', filters.decision_type);
    const { data, error } = await q;
    if (error) throw error;
    return data ?? [];
  }

  async listCompleted(userId: string): Promise<Decision[]> {
    return this.listByUser(userId, { status: 'COMPLETED' });
  }

  async listFailed(userId: string): Promise<Decision[]> {
    return this.listByUser(userId, { status: 'FAILED' });
  }

  // ---- Decision ↔ Entity links ----------------------------

  async linkToEntity(
    decisionId: string,
    nodeId: string,
    relType: DecisionRelationshipType,
  ): Promise<DecisionEntity> {
    const { data, error } = await this.db
      .from('decision_entities')
      .upsert({ decision_id: decisionId, node_id: nodeId, relationship_type: relType },
               { onConflict: 'decision_id,node_id,relationship_type' })
      .select().single();
    if (error) throw error;
    return data;
  }

  async getDecisionEntities(decisionId: string): Promise<DecisionEntity[]> {
    const { data, error } = await this.db
      .from('decision_entities').select()
      .eq('decision_id', decisionId);
    if (error) throw error;
    return data ?? [];
  }

  async getEntityDecisions(nodeId: string): Promise<DecisionEntity[]> {
    const { data, error } = await this.db
      .from('decision_entities').select()
      .eq('node_id', nodeId);
    if (error) throw error;
    return data ?? [];
  }

  async unlinkFromEntity(decisionId: string, nodeId: string): Promise<void> {
    const { error } = await this.db
      .from('decision_entities')
      .delete().eq('decision_id', decisionId).eq('node_id', nodeId);
    if (error) throw error;
  }

  // ---- Evaluations ----------------------------------------

  async saveEvaluation(
    decisionId: string,
    input: EvaluateDecisionInput,
  ): Promise<DecisionEvaluation> {
    const { data, error } = await this.db
      .from('decision_evaluations')
      .insert({ decision_id: decisionId, ...input })
      .select().single();
    if (error) throw error;
    return data;
  }

  async getEvaluations(decisionId: string): Promise<DecisionEvaluation[]> {
    const { data, error } = await this.db
      .from('decision_evaluations').select()
      .eq('decision_id', decisionId)
      .order('evaluated_at', { ascending: false });
    if (error) throw error;
    return data ?? [];
  }

  async getLatestEvaluation(decisionId: string): Promise<DecisionEvaluation | null> {
    const { data, error } = await this.db
      .from('decision_evaluations').select()
      .eq('decision_id', decisionId)
      .order('evaluated_at', { ascending: false })
      .limit(1).maybeSingle();
    if (error) throw error;
    return data;
  }
}
