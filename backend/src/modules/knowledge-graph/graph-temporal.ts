// ============================================================
// graph-temporal.ts — Temporal queries over the graph
//
// No migration needed:
//   nodes: created_at = first_seen_at, last_mentioned_at = last_seen_at
//   edges: created_at = first_seen_at, last_seen_at already exists
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import type { GraphNode, GraphEdge } from './graph.types';

export interface TemporalNodeInfo {
  node:         GraphNode;
  first_seen_at: string;   // node.created_at
  last_seen_at:  string;   // node.last_mentioned_at
  age_days:      number;
}

export interface TemporalEdgeInfo {
  edge:          GraphEdge;
  source_name:   string;
  target_name:   string;
  first_seen_at: string;   // edge.created_at
  last_seen_at:  string;   // edge.last_seen_at
  age_days:      number;
}

export interface GraphChanges {
  since:          string;
  new_nodes:      TemporalNodeInfo[];
  new_edges:      TemporalEdgeInfo[];
  active_nodes:   TemporalNodeInfo[];   // last_mentioned_at >= since
}

export class GraphTemporalService {
  constructor(private readonly db: SupabaseClient) {}

  async getNodeFirstSeen(userId: string, name: string): Promise<TemporalNodeInfo | null> {
    const { data } = await this.db
      .from('graph_nodes')
      .select()
      .eq('user_id', userId)
      .ilike('name', name)
      .eq('is_archived', false)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (!data) return null;
    return toTemporalNode(data as GraphNode);
  }

  async getChangesSince(userId: string, since: Date): Promise<GraphChanges> {
    const iso = since.toISOString();
    const [{ data: newNodes }, { data: newEdges }, { data: activeNodes }] = await Promise.all([
      this.db.from('graph_nodes').select()
        .eq('user_id', userId).eq('is_archived', false)
        .gte('created_at', iso).order('created_at', { ascending: false }),
      this.db.from('graph_edges').select()
        .eq('user_id', userId).eq('is_archived', false)
        .gte('created_at', iso).order('created_at', { ascending: false }),
      this.db.from('graph_nodes').select()
        .eq('user_id', userId).eq('is_archived', false)
        .gte('last_mentioned_at', iso).order('last_mentioned_at', { ascending: false }),
    ]);

    // Resolve edge node names in parallel
    const edgeNodeIds = new Set<string>();
    for (const e of newEdges ?? []) {
      edgeNodeIds.add(e.source_node_id);
      edgeNodeIds.add(e.target_node_id);
    }
    let nodeNameMap = new Map<string, string>();
    if (edgeNodeIds.size) {
      const { data: nameRows } = await this.db
        .from('graph_nodes').select('id, name')
        .in('id', [...edgeNodeIds]);
      nodeNameMap = new Map((nameRows ?? []).map((n: { id: string; name: string }) => [n.id, n.name]));
    }

    return {
      since: iso,
      new_nodes:    (newNodes   ?? []).map(n => toTemporalNode(n as GraphNode)),
      new_edges:    (newEdges   ?? []).map(e => toTemporalEdge(e as GraphEdge, nodeNameMap)),
      active_nodes: (activeNodes ?? []).map(n => toTemporalNode(n as GraphNode)),
    };
  }
}

// ---- Helpers ------------------------------------------------

function toTemporalNode(node: GraphNode): TemporalNodeInfo {
  return {
    node,
    first_seen_at: node.created_at,
    last_seen_at:  node.last_mentioned_at,
    age_days: Math.floor((Date.now() - new Date(node.created_at).getTime()) / 86_400_000),
  };
}

function toTemporalEdge(edge: GraphEdge, names: Map<string, string>): TemporalEdgeInfo {
  return {
    edge,
    source_name:   names.get(edge.source_node_id) ?? edge.source_node_id,
    target_name:   names.get(edge.target_node_id) ?? edge.target_node_id,
    first_seen_at: edge.created_at,
    last_seen_at:  edge.last_seen_at,
    age_days: Math.floor((Date.now() - new Date(edge.created_at).getTime()) / 86_400_000),
  };
}
