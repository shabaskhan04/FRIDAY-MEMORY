// ============================================================
// graph.repository.ts — Supabase data access layer
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  GraphNode, GraphEdge, GraphSnapshot, GraphEvent,
  CreateNodeInput, UpdateNodeInput,
  CreateEdgeInput,
  EventType, NeighborhoodNode,
} from './graph.types';
import { hydrateNode, hydrateNodes, hydrateSemanticNode } from './graph.hydrator';

export class GraphRepository {
  constructor(private readonly db: SupabaseClient) {}

  /** Expose the underlying client for services that need direct queries. */
  getDb(): SupabaseClient { return this.db; }

  // ---- Nodes ------------------------------------------------

  async createNode(input: CreateNodeInput): Promise<GraphNode> {
    const { data, error } = await this.db
      .from('graph_nodes')
      .insert(input)
      .select()
      .single();
    if (error) throw error;
    return hydrateNode(data);
  }

  async getNodeById(id: string, userId: string): Promise<GraphNode | null> {
    const { data, error } = await this.db
      .from('graph_nodes')
      .select()
      .eq('id', id)
      .eq('user_id', userId)
      .eq('is_archived', false)
      .maybeSingle();
    if (error) throw error;
    return data ? hydrateNode(data) : null;
  }

  async updateNode(id: string, userId: string, input: UpdateNodeInput): Promise<GraphNode> {
    const { data, error } = await this.db
      .from('graph_nodes')
      .update(input)
      .eq('id', id)
      .eq('user_id', userId)
      .select()
      .single();
    if (error) throw error;
    return hydrateNode(data);
  }

  async findNodesByName(userId: string, name: string): Promise<GraphNode[]> {
    const { data, error } = await this.db
      .from('graph_nodes')
      .select()
      .eq('user_id', userId)
      .eq('is_archived', false)
      .ilike('name', name);
    if (error) throw error;
    return hydrateNodes(data ?? []);
  }

  /** Fuzzy name search via pg_trgm similarity */
  async fuzzyFindNodes(userId: string, name: string, threshold = 0.3): Promise<GraphNode[]> {
    const { data, error } = await this.db
      .rpc('search_nodes_fuzzy', { p_user_id: userId, p_name: name, p_threshold: threshold });
    if (error) throw error;
    return hydrateNodes(data ?? []);
  }

  async findNodesByAlias(userId: string, alias: string): Promise<GraphNode[]> {
    const { data, error } = await this.db
      .from('graph_nodes')
      .select()
      .eq('user_id', userId)
      .eq('is_archived', false)
      .contains('aliases', [alias]);
    if (error) throw error;
    return hydrateNodes(data ?? []);
  }

  async getMostImportantNodes(userId: string, limit = 20): Promise<GraphNode[]> {
    const { data, error } = await this.db
      .from('graph_nodes')
      .select()
      .eq('user_id', userId)
      .eq('is_archived', false)
      .order('importance_score', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return hydrateNodes(data ?? []);
  }

  async getRecentNodes(userId: string, limit = 20): Promise<GraphNode[]> {
    const { data, error } = await this.db
      .from('graph_nodes')
      .select()
      .eq('user_id', userId)
      .eq('is_archived', false)
      .order('last_mentioned_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return hydrateNodes(data ?? []);
  }

  async getNodesByType(userId: string, nodeType: string, limit = 50): Promise<GraphNode[]> {
    const { data, error } = await this.db
      .from('graph_nodes')
      .select()
      .eq('user_id', userId)
      .eq('node_type', nodeType)
      .eq('is_archived', false)
      .order('importance_score', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return hydrateNodes(data ?? []);
  }

  async incrementMentionCount(id: string, userId: string): Promise<void> {
    const { error } = await this.db.rpc('increment_node_mention', {
      p_node_id: id,
      p_user_id: userId,
    });
    if (error) throw error;
  }

  async semanticSearchNodes(
    userId: string,
    embedding: number[],
    limit = 10,
    minScore = 0.7,
  ): Promise<Array<GraphNode & { similarity: number }>> {
    const { data, error } = await this.db.rpc('search_nodes_semantic', {
      p_user_id:   userId,
      p_embedding: JSON.stringify(embedding),
      p_limit:     limit,
      p_min_score: minScore,
    });
    if (error) throw error;
    return (data ?? []).map(hydrateSemanticNode);
  }

  async updateNodeScores(
    id: string,
    userId: string,
    scores: { importance_score: number },
  ): Promise<void> {
    const { error } = await this.db
      .from('graph_nodes')
      .update(scores)
      .eq('id', id)
      .eq('user_id', userId);
    if (error) throw error;
  }

  // ---- Edges ------------------------------------------------

  async upsertEdge(input: CreateEdgeInput): Promise<GraphEdge> {
    if (input.source_node_id === input.target_node_id) {
      console.warn(`[graph] skipped self-loop edge at upsertEdge: node ${input.source_node_id}`);
      throw new Error(`Self-loop edge rejected: source_node_id === target_node_id (${input.source_node_id})`);
    }
    const { data, error } = await this.db
      .from('graph_edges')
      .upsert(
        {
          ...input,
          last_seen_at: new Date().toISOString(),
        },
        {
          onConflict: 'user_id,source_node_id,target_node_id,relationship_type',
          ignoreDuplicates: false,
        },
      )
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async createEdge(input: CreateEdgeInput): Promise<GraphEdge> {
    if (input.source_node_id === input.target_node_id) {
      console.warn(`[graph] skipped self-loop edge at createEdge: node ${input.source_node_id}`);
      throw new Error(`Self-loop edge rejected: source_node_id === target_node_id (${input.source_node_id})`);
    }
    const { data, error } = await this.db
      .from('graph_edges')
      .insert(input)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async getEdgesByNode(
    userId: string,
    nodeId: string,
    direction: 'outbound' | 'inbound' | 'both' = 'both',
  ): Promise<GraphEdge[]> {
    let query = this.db
      .from('graph_edges')
      .select()
      .eq('user_id', userId)
      .eq('is_archived', false);

    if (direction === 'outbound')      query = query.eq('source_node_id', nodeId);
    else if (direction === 'inbound')  query = query.eq('target_node_id', nodeId);
    else                               query = query.or(`source_node_id.eq.${nodeId},target_node_id.eq.${nodeId}`);

    const { data, error } = await query;
    if (error) throw error;
    return data ?? [];
  }

  async getEdgeBetween(
    userId: string,
    sourceId: string,
    targetId: string,
    relType?: string,
  ): Promise<GraphEdge | null> {
    let query = this.db
      .from('graph_edges')
      .select()
      .eq('user_id', userId)
      .eq('source_node_id', sourceId)
      .eq('target_node_id', targetId)
      .eq('is_archived', false);
    if (relType) query = query.eq('relationship_type', relType);
    const { data, error } = await query.maybeSingle();
    if (error) throw error;
    return data;
  }

  async incrementEdgeMention(edgeId: string, userId: string): Promise<void> {
    const { error } = await this.db.rpc('increment_edge_mention', {
      p_edge_id: edgeId,
      p_user_id: userId,
    });
    if (error) throw error;
  }

  async updateEdgeStrength(edgeId: string, userId: string, strength: number): Promise<void> {
    const { error } = await this.db
      .from('graph_edges')
      .update({ strength, last_seen_at: new Date().toISOString() })
      .eq('id', edgeId)
      .eq('user_id', userId);
    if (error) throw error;
  }

  /**
   * C-1/C-2: Batch fetch all edges touching any of the given node IDs in one query.
   * Returns a Map<nodeId, GraphEdge[]> for O(1) fan-out lookups.
   */
  async getEdgesByNodeIds(userId: string, nodeIds: string[]): Promise<Map<string, GraphEdge[]>> {
    if (!nodeIds.length) return new Map();
    const result = new Map<string, GraphEdge[]>(nodeIds.map(id => [id, []]));
    const CHUNK = 50;
    for (let i = 0; i < nodeIds.length; i += CHUNK) {
      const chunk = nodeIds.slice(i, i + CHUNK);
      const { data, error } = await this.db
        .from('graph_edges')
        .select()
        .eq('user_id', userId)
        .eq('is_archived', false)
        .or(chunk.map(id => `source_node_id.eq.${id},target_node_id.eq.${id}`).join(','));
      if (error) throw error;
      for (const e of data ?? []) {
        result.get(e.source_node_id)?.push(e);
        if (e.source_node_id !== e.target_node_id) result.get(e.target_node_id)?.push(e);
      }
    }
    return result;
  }

  /**
   * C-1: Batch fetch edge counts per node in one query.
   */
  async getEdgeCountsByNodeIds(userId: string, nodeIds: string[]): Promise<Map<string, number>> {
    if (!nodeIds.length) return new Map();
    const { data, error } = await this.db
      .from('graph_edges')
      .select('source_node_id, target_node_id')
      .eq('user_id', userId)
      .eq('is_archived', false)
      .or(nodeIds.map(id => `source_node_id.eq.${id},target_node_id.eq.${id}`).join(','));
    if (error) throw error;
    const counts = new Map<string, number>();
    for (const e of data ?? []) {
      counts.set(e.source_node_id, (counts.get(e.source_node_id) ?? 0) + 1);
      counts.set(e.target_node_id, (counts.get(e.target_node_id) ?? 0) + 1);
    }
    return counts;
  }

  async getStaleEdges(userId: string, beforeDate: Date): Promise<GraphEdge[]> {
    const { data, error } = await this.db
      .from('graph_edges')
      .select()
      .eq('user_id', userId)
      .eq('is_archived', false)
      .lt('last_seen_at', beforeDate.toISOString());
    if (error) throw error;
    return data ?? [];
  }

  // ---- Neighborhood (via DB function) -----------------------

  async getNeighborhood(
    userId: string,
    nodeId: string,
    depth = 2,
  ): Promise<NeighborhoodNode[]> {
    const { data, error } = await this.db.rpc('get_node_neighborhood', {
      p_user_id:   userId,
      p_node_id:   nodeId,
      p_max_depth: depth,
    });
    if (error) throw error;

    if (!data?.length) return [];

    const nodeIds: string[] = data.map((r: any) => r.node_id);
    const { data: nodes, error: nErr } = await this.db
      .from('graph_nodes')
      .select()
      .in('id', nodeIds)
      .eq('is_archived', false);
    if (nErr) throw nErr;

    const nodeMap = new Map((nodes ?? []).map((n: GraphNode) => [n.id, hydrateNode(n as unknown as Record<string, unknown>)]));
    return data
      .filter((r: any) => r.node_id !== nodeId)
      .map((r: any) => ({
        node: nodeMap.get(r.node_id)!,
        depth: r.depth,
        path: r.path,
      }))
      .filter((r: NeighborhoodNode) => r.node);
  }

  // ---- Snapshots --------------------------------------------

  async createSnapshot(
    userId: string,
    trigger: string,
  ): Promise<GraphSnapshot> {
    const [{ data: nodes }, { data: edges }] = await Promise.all([
      this.db.from('graph_nodes').select().eq('user_id', userId).eq('is_archived', false)
        .order('importance_score', { ascending: false }).limit(500),
      this.db.from('graph_edges').select().eq('user_id', userId).eq('is_archived', false)
        .order('strength', { ascending: false }).limit(2000),
    ]);

    const { data, error } = await this.db
      .from('graph_snapshots')
      .insert({
        user_id:    userId,
        snapshot:   { nodes: nodes ?? [], edges: edges ?? [] },
        node_count: nodes?.length ?? 0,
        edge_count: edges?.length ?? 0,
        trigger,
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async getLatestSnapshot(userId: string): Promise<GraphSnapshot | null> {
    const { data, error } = await this.db
      .from('graph_snapshots')
      .select()
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  // ---- Events -----------------------------------------------

  async logEvent(
    userId: string,
    eventType: EventType,
    entityId: string | null,
    entityKind: 'node' | 'edge' | null,
    payload: Record<string, unknown> = {},
  ): Promise<void> {
    const { error } = await this.db
      .from('graph_events')
      .insert({ user_id: userId, event_type: eventType, entity_id: entityId, entity_kind: entityKind, payload });
    if (error) throw error;
  }

  async getRecentEvents(userId: string, limit = 50): Promise<GraphEvent[]> {
    const { data, error } = await this.db
      .from('graph_events')
      .select()
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data ?? [];
  }

  // ---- T8: Pin / Unpin edges --------------------------------

  async pinEdge(edgeId: string, userId: string): Promise<void> {
    const { error } = await this.db
      .from('graph_edges')
      .update({ is_pinned: true })
      .eq('id', edgeId)
      .eq('user_id', userId);
    if (error) throw error;
    await this.logEvent(userId, 'EDGE_PINNED', edgeId, 'edge');
  }

  async unpinEdge(edgeId: string, userId: string): Promise<void> {
    const { error } = await this.db
      .from('graph_edges')
      .update({ is_pinned: false })
      .eq('id', edgeId)
      .eq('user_id', userId);
    if (error) throw error;
    await this.logEvent(userId, 'EDGE_UNPINNED', edgeId, 'edge');
  }

  // ---- P2: Structured snapshots ----------------------------

  async createStructuredSnapshot(
    userId: string,
    trigger: string,
    summary: {
      top_entities: unknown[];
      top_projects: unknown[];
      top_people:   unknown[];
      top_goals:    unknown[];
    },
  ): Promise<GraphSnapshot> {
    const [{ data: nodes }, { data: edges }] = await Promise.all([
      this.db.from('graph_nodes').select().eq('user_id', userId).eq('is_archived', false)
        .order('importance_score', { ascending: false }).limit(500),
      this.db.from('graph_edges').select().eq('user_id', userId).eq('is_archived', false)
        .order('strength', { ascending: false }).limit(2000),
    ]);

    const { data, error } = await this.db
      .from('graph_snapshots')
      .insert({
        user_id:      userId,
        snapshot:     { nodes: nodes ?? [], edges: edges ?? [] },
        node_count:   nodes?.length ?? 0,
        edge_count:   edges?.length ?? 0,
        trigger,
        ...summary,
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async getSnapshotById(userId: string, snapshotId: string): Promise<GraphSnapshot | null> {
    const { data, error } = await this.db
      .from('graph_snapshots')
      .select()
      .eq('id', snapshotId)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async getSnapshots(userId: string, limit = 20): Promise<GraphSnapshot[]> {
    const { data, error } = await this.db
      .from('graph_snapshots')
      .select()
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data ?? [];
  }
}
