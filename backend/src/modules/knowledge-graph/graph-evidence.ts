// ============================================================
// graph-evidence.ts — Memory ↔ Graph evidence linking
//
// source_memory_ids already stored on graph_nodes and graph_edges.
// This service retrieves the actual memory rows that support
// a given entity or relationship.
// ============================================================

import type { SupabaseClient }  from '@supabase/supabase-js';
import type { GraphRepository } from './graph.repository';
import type { GraphSearch }     from './graph.search';
import type { GraphNode, GraphEdge } from './graph.types';

export interface EvidenceMemory {
  id:         string;
  content:    string;
  intent_tag: string | null;
  created_at: string;
}

export interface NodeEvidence {
  node:     GraphNode;
  memories: EvidenceMemory[];
}

export interface EdgeEvidence {
  edge:         GraphEdge;
  source_node:  GraphNode | null;
  target_node:  GraphNode | null;
  memories:     EvidenceMemory[];
}

export class GraphEvidenceService {
  constructor(
    private readonly db:     SupabaseClient,
    private readonly repo:   GraphRepository,
    private readonly search: GraphSearch,
  ) {}

  /** Return memories that support a named entity node. */
  async getNodeEvidence(userId: string, name: string): Promise<NodeEvidence | null> {
    const node = await this.search.findByName(userId, name);
    if (!node) return null;
    return this.getNodeEvidenceById(userId, node.id);
  }

  async getNodeEvidenceById(userId: string, nodeId: string): Promise<NodeEvidence | null> {
    const node = await this.repo.getNodeById(nodeId, userId);
    if (!node) return null;
    const memories = await this.fetchMemories(node.source_memory_ids ?? []);
    return { node, memories };
  }

  /** Return memories that support a specific edge (relationship). */
  async getEdgeEvidence(userId: string, edgeId: string): Promise<EdgeEvidence | null> {
    const { data, error } = await this.db
      .from('graph_edges')
      .select()
      .eq('id', edgeId)
      .eq('user_id', userId)
      .maybeSingle();
    if (error || !data) return null;

    const edge: GraphEdge = data;
    const [source_node, target_node, memories] = await Promise.all([
      this.repo.getNodeById(edge.source_node_id, userId),
      this.repo.getNodeById(edge.target_node_id, userId),
      this.fetchMemories(edge.source_memory_ids ?? []),
    ]);

    return { edge, source_node, target_node, memories };
  }

  /**
   * Return all nodes and edges that reference a given memory ID,
   * showing what graph knowledge was extracted from it.
   */
  async getMemoryGraphContext(userId: string, memoryId: string): Promise<{
    nodes: GraphNode[];
    edges: GraphEdge[];
  }> {
    const [{ data: nodeRows }, { data: edgeRows }] = await Promise.all([
      this.db
        .from('graph_nodes')
        .select()
        .eq('user_id', userId)
        .eq('is_archived', false)
        .contains('source_memory_ids', [memoryId]),
      this.db
        .from('graph_edges')
        .select()
        .eq('user_id', userId)
        .eq('is_archived', false)
        .contains('source_memory_ids', [memoryId]),
    ]);

    return {
      nodes: (nodeRows ?? []) as GraphNode[],
      edges: (edgeRows ?? []) as GraphEdge[],
    };
  }

  // ---- Private helpers --------------------------------------

  private async fetchMemories(ids: string[]): Promise<EvidenceMemory[]> {
    if (!ids.length) return [];
    const { data, error } = await this.db
      .from('raw_ledgers')
      .select('id, content, intent_tag, created_at')
      .in('id', ids)
      .order('created_at', { ascending: false });
    if (error) return [];
    return (data ?? []) as EvidenceMemory[];
  }
}
