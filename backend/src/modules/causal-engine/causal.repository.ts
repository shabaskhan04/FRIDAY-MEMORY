// ============================================================
// causal.repository.ts — Supabase data access for causal edges
// Causal edges live in graph_edges with causal-specific columns.
// ============================================================
import type { SupabaseClient } from '@supabase/supabase-js';
import type { CausalEdge, CreateCausalEdgeInput } from './causal.types';

const CAUSAL_TYPES = ['CAUSED', 'CONTRIBUTED_TO', 'ENABLED', 'PREVENTED', 'ACCELERATED', 'DELAYED'];

export class CausalRepository {
  constructor(private readonly db: SupabaseClient) {}

  async createCausalEdge(input: CreateCausalEdgeInput): Promise<CausalEdge> {
    const { data, error } = await this.db
      .from('graph_edges')
      .insert({
        user_id:           input.user_id,
        source_node_id:    input.source_node_id,
        target_node_id:    input.target_node_id,
        relationship_type: input.relationship_type,
        strength:          input.causal_strength,
        confidence:        input.confidence ?? 0.8,
        causal_strength:   input.causal_strength,
        causal_evidence:   input.evidence ?? [],
        source_count:      (input.source_memory_ids ?? []).length || 1,
        source_memory_ids: input.source_memory_ids ?? [],
      })
      .select().single();
    if (error) throw error;
    return rowToCausalEdge(data);
  }

  async getCausalEdgesFrom(userId: string, nodeId: string): Promise<CausalEdge[]> {
    const { data, error } = await this.db
      .from('graph_edges').select()
      .eq('user_id', userId)
      .eq('source_node_id', nodeId)
      .eq('is_archived', false)
      .in('relationship_type', CAUSAL_TYPES);
    if (error) throw error;
    return (data ?? []).map(rowToCausalEdge);
  }

  async getCausalEdgesTo(userId: string, nodeId: string): Promise<CausalEdge[]> {
    const { data, error } = await this.db
      .from('graph_edges').select()
      .eq('user_id', userId)
      .eq('target_node_id', nodeId)
      .eq('is_archived', false)
      .in('relationship_type', CAUSAL_TYPES);
    if (error) throw error;
    return (data ?? []).map(rowToCausalEdge);
  }

  async getAllCausalEdges(userId: string, limit = 500): Promise<CausalEdge[]> {
    const { data, error } = await this.db
      .from('graph_edges').select()
      .eq('user_id', userId)
      .eq('is_archived', false)
      .in('relationship_type', CAUSAL_TYPES)
      .order('causal_strength', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data ?? []).map(rowToCausalEdge);
  }

  async updateCausalStrength(edgeId: string, userId: string, strength: number): Promise<void> {
    const { error } = await this.db
      .from('graph_edges')
      .update({ causal_strength: strength, strength })
      .eq('id', edgeId).eq('user_id', userId);
    if (error) throw error;
  }
}

function rowToCausalEdge(row: any): CausalEdge {
  return {
    id:                row.id,
    source_node_id:    row.source_node_id,
    target_node_id:    row.target_node_id,
    relationship_type: row.relationship_type,
    causal_strength:   row.causal_strength ?? row.strength,
    confidence:        row.confidence,
    source_count:      row.source_count ?? 1,
    causal_evidence:   row.causal_evidence ?? [],
    last_seen_at:      row.last_seen_at,
  };
}
