// ============================================================
// graph-analytics.ts — Degree centrality, relationship counts,
// entity importance ranking. Pure computation, no LLM.
// ============================================================

import type { GraphRepository } from './graph.repository';
import type { GraphNode }       from './graph.types';

export interface NodeAnalytics {
  node:               GraphNode;
  degree:             number;   // total edges (in + out)
  in_degree:          number;
  out_degree:         number;
  degree_centrality:  number;   // degree / (N-1), normalised 0–1
  relationship_counts: Record<string, number>;  // rel_type → count
  importance_score:   number;   // stored on node, surfaced here for convenience
}

export interface GraphAnalytics {
  total_nodes:       number;
  total_edges:       number;
  most_important:    NodeAnalytics[];   // top N by importance_score
  most_connected:    NodeAnalytics[];   // top N by degree
  by_type:           Record<string, number>;  // node_type → count
  computed_at:       string;
}

export class GraphAnalyticsEngine {
  constructor(private readonly repo: GraphRepository) {}

  async computeAnalytics(userId: string, topN = 10): Promise<GraphAnalytics> {
    // Fetch all non-archived nodes and edges in two parallel queries
    const [allNodes, edgeCounts] = await Promise.all([
      this.repo.getMostImportantNodes(userId, 500),
      this.repo.getEdgeCountsByNodeIds(userId, []),   // we'll batch after
    ]);

    const N = allNodes.length;

    // Batch-fetch edge counts for all nodes in one query
    const edgeMap = await this.repo.getEdgesByNodeIds(
      userId,
      allNodes.map(n => n.id),
    );

    const analytics: NodeAnalytics[] = allNodes.map(node => {
      const edges = edgeMap.get(node.id) ?? [];
      const in_degree  = edges.filter(e => e.target_node_id === node.id).length;
      const out_degree = edges.filter(e => e.source_node_id === node.id).length;
      const degree     = new Set(edges.map(e => e.id)).size; // deduped

      const relationship_counts: Record<string, number> = {};
      for (const e of edges) {
        relationship_counts[e.relationship_type] =
          (relationship_counts[e.relationship_type] ?? 0) + 1;
      }

      return {
        node,
        degree,
        in_degree,
        out_degree,
        degree_centrality: N > 1 ? degree / (N - 1) : 0,
        relationship_counts,
        importance_score: node.importance_score,
      };
    });

    const by_type: Record<string, number> = {};
    for (const n of allNodes) by_type[n.node_type] = (by_type[n.node_type] ?? 0) + 1;

    // Count total unique edges across all nodes
    const allEdgeIds = new Set(
      [...edgeMap.values()].flatMap(es => es.map(e => e.id)),
    );

    return {
      total_nodes:    N,
      total_edges:    allEdgeIds.size,
      most_important: [...analytics]
        .sort((a, b) => b.importance_score - a.importance_score)
        .slice(0, topN),
      most_connected: [...analytics]
        .sort((a, b) => b.degree - a.degree)
        .slice(0, topN),
      by_type,
      computed_at: new Date().toISOString(),
    };
  }

  /** Single-node analytics — used by entity profile enrichment */
  async getNodeAnalytics(userId: string, nodeId: string): Promise<NodeAnalytics | null> {
    const [node, edges, allNodes] = await Promise.all([
      this.repo.getNodeById(nodeId, userId),
      this.repo.getEdgesByNode(userId, nodeId, 'both'),
      this.repo.getMostImportantNodes(userId, 500),
    ]);
    if (!node) return null;

    const N         = allNodes.length;
    const in_degree  = edges.filter(e => e.target_node_id === nodeId).length;
    const out_degree = edges.filter(e => e.source_node_id === nodeId).length;
    const degree     = edges.length;

    const relationship_counts: Record<string, number> = {};
    for (const e of edges)
      relationship_counts[e.relationship_type] = (relationship_counts[e.relationship_type] ?? 0) + 1;

    return {
      node,
      degree, in_degree, out_degree,
      degree_centrality: N > 1 ? degree / (N - 1) : 0,
      relationship_counts,
      importance_score: node.importance_score,
    };
  }
}
