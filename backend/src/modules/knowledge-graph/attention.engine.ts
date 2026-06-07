// ============================================================
// attention.engine.ts — P3: Where is attention being spent?
// Pure graph analytics. No LLM.
// ============================================================

import type { GraphRepository } from './graph.repository';
import type {
  GraphNode, GraphEdge, NodeType, AttentionScore, AttentionDistribution,
} from './graph.types';

// ---- Constants -------------------------------------------

const MENTION_CAP    = 100;
const MAX_DEPTH_DAYS = 30;   // recency window

export class AttentionEngine {
  constructor(private readonly repo: GraphRepository) {}

  // ---- Core formula ----------------------------------------

  /**
   * attentionScore =
   *   normalizedMentionCount * 0.4   (how often mentioned)
   *   + recencyFactor        * 0.3   (how recently mentioned, linear 30-day window)
   *   + relationshipGrowth   * 0.2   (edge count growth vs last snapshot estimate)
   *   + edgeActivity         * 0.1   (avg edge strength of active edges)
   */
  calculateAttentionScore(
    node: GraphNode,
    edges: Array<{ strength: number; last_seen_at: string; is_archived: boolean }>,
    edgeCountAtLastSnapshot = 0,
  ): AttentionScore {
    const activeEdges = edges.filter(e => !e.is_archived);

    const mention_score = Math.log1p(Math.min(node.mention_count, MENTION_CAP))
      / Math.log1p(MENTION_CAP);

    const daysSince    = (Date.now() - new Date(node.last_mentioned_at).getTime()) / 86_400_000;
    const recency_score = Math.max(0, 1 - daysSince / MAX_DEPTH_DAYS);

    const currentEdgeCount = activeEdges.length;
    const relationship_growth = edgeCountAtLastSnapshot === 0
      ? (currentEdgeCount > 0 ? 1 : 0)
      : Math.min(1, (currentEdgeCount - edgeCountAtLastSnapshot) / Math.max(edgeCountAtLastSnapshot, 1));

    const edge_activity = activeEdges.length
      ? activeEdges.reduce((s, e) => s + e.strength, 0) / activeEdges.length
      : 0;

    const attention_score = Math.min(1, Math.max(0,
      mention_score        * 0.4 +
      recency_score        * 0.3 +
      Math.max(0, relationship_growth) * 0.2 +
      edge_activity        * 0.1,
    ));

    return {
      node,
      attention_score,
      mention_score,
      recency_score,
      relationship_growth: Math.max(0, relationship_growth),
      edge_activity,
    };
  }

  // ---- Public API ------------------------------------------

  /**
   * getTopAttentionNodes() — returns nodes ranked by attention_score.
   * Optionally filtered by node_type.
   */
  async getTopAttentionNodes(
    userId: string,
    options: { nodeType?: NodeType; limit?: number } = {},
  ): Promise<AttentionScore[]> {
    const limit = options.limit ?? 20;

    const nodes = options.nodeType
      ? await this.repo.getNodesByType(userId, options.nodeType, limit * 3)
      : await this.repo.getMostImportantNodes(userId, limit * 3);

    const snapshot = await this.repo.getLatestSnapshot(userId);
    const prevEdgeCounts = this.buildPrevEdgeCounts(snapshot);

    // C-2: single batch query instead of N parallel queries
    const edgeMap = await this.repo.getEdgesByNodeIds(userId, nodes.map(n => n.id));
    const scored = nodes.map((node) => {
      const edges = edgeMap.get(node.id) ?? [];
      return this.calculateAttentionScore(node, edges, prevEdgeCounts.get(node.id) ?? 0);
    });

    return scored.sort((a, b) => b.attention_score - a.attention_score).slice(0, limit);
  }

  /**
   * getAttentionDistribution() — average attention score per node type.
   * Answers: "Am I spending more attention on projects vs people vs goals?"
   */
  async getAttentionDistribution(userId: string): Promise<AttentionDistribution> {
    const all     = await this.repo.getMostImportantNodes(userId, 200);
    const snapshot = await this.repo.getLatestSnapshot(userId);
    const prevEdgeCounts = this.buildPrevEdgeCounts(snapshot);

    // C-2: single batch query instead of 200 parallel queries
    const edgeMap = this.repo.getEdgesByNodeIds
      ? await this.repo.getEdgesByNodeIds(userId, all.map(n => n.id))
      : new Map(await Promise.all(all.map(async n => [n.id, await this.repo.getEdgesByNode(userId, n.id)] as [string, GraphEdge[]])));
    const buckets  = new Map<string, number[]>();

    for (const node of all) {
      const edges = edgeMap.get(node.id) ?? [];
      const score = this.calculateAttentionScore(node, edges, prevEdgeCounts.get(node.id) ?? 0);
      if (!buckets.has(node.node_type)) buckets.set(node.node_type, []);
      buckets.get(node.node_type)!.push(score.attention_score);
    }

    const by_type: Record<string, number> = {};
    for (const [type, scores] of buckets) {
      by_type[type] = scores.reduce((s, v) => s + v, 0) / scores.length;
    }

    return {
      by_type:     by_type as Record<NodeType, number>,
      total_nodes: all.length,
      computed_at: new Date().toISOString(),
    };
  }

  // ---- Private helper --------------------------------------

  private buildPrevEdgeCounts(snapshot: any): Map<string, number> {
    if (!snapshot?.snapshot?.edges) return new Map();
    const counts = new Map<string, number>();
    for (const e of snapshot.snapshot.edges) {
      counts.set(e.source_node_id, (counts.get(e.source_node_id) ?? 0) + 1);
      counts.set(e.target_node_id, (counts.get(e.target_node_id) ?? 0) + 1);
    }
    return counts;
  }
}
