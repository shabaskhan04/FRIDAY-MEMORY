// ============================================================
// causal.analysis.ts — Higher-level causal analytics
// ============================================================
import type { CausalRepository }  from './causal.repository';
import type { CausalPathEngine }  from './causal-path.engine';
import type {
  CausalEdge, CausalPath, RootCauseResult,
  DownstreamEffect, InfluentialNode,
} from './causal.types';

export class CausalAnalysis {
  constructor(
    private readonly repo:       CausalRepository,
    private readonly pathEngine: CausalPathEngine,
  ) {}

  // ---- Delegation to path engine ---------------------------

  findCausalPath(userId: string, from: string, to: string): Promise<CausalPath | null> {
    return this.pathEngine.findCausalPath(userId, from, to);
  }

  findRootCauses(userId: string, effectNodeId: string, maxDepth?: number): Promise<RootCauseResult[]> {
    return this.pathEngine.findRootCauses(userId, effectNodeId, maxDepth);
  }

  findDownstreamEffects(userId: string, causeNodeId: string, maxDepth?: number): Promise<DownstreamEffect[]> {
    return this.pathEngine.findDownstreamEffects(userId, causeNodeId, maxDepth);
  }

  findMostInfluentialNodes(userId: string, limit?: number): Promise<InfluentialNode[]> {
    return this.pathEngine.findMostInfluentialNodes(userId, limit);
  }

  // ---- Causal graph summary --------------------------------

  /**
   * getCausalSummary() — high-level stats about the causal graph.
   * Used by weekly digest and Ask Friday context.
   */
  async getCausalSummary(userId: string): Promise<{
    total_causal_edges: number;
    avg_causal_strength: number;
    strongest_causal_link: CausalEdge | null;
    most_influential: InfluentialNode | null;
  }> {
    const edges = await this.repo.getAllCausalEdges(userId, 1000);
    const avg   = edges.length
      ? edges.reduce((s, e) => s + e.causal_strength, 0) / edges.length
      : 0;
    const strongest = edges.sort((a, b) => b.causal_strength - a.causal_strength)[0] ?? null;
    const influential = (await this.pathEngine.findMostInfluentialNodes(userId, 1))[0] ?? null;

    return {
      total_causal_edges: edges.length,
      avg_causal_strength: avg,
      strongest_causal_link: strongest,
      most_influential: influential,
    };
  }

  /**
   * getStrongestCausalChains() — returns top N complete causal chains
   * by total path strength.
   */
  async getStrongestCausalChains(userId: string, limit = 5): Promise<CausalPath[]> {
    // Pre-fetch all edges to score nodes
    const allEdges = await this.repo.getAllCausalEdges(userId, 500);
    const bySource = new Map<string, CausalEdge[]>();
    for (const e of allEdges) {
      const arr = bySource.get(e.source_node_id) ?? [];
      arr.push(e);
      bySource.set(e.source_node_id, arr);
    }

    const scores = new Map<string, number>();
    for (const [src, edges] of bySource) {
      const avg = edges.reduce((s, e) => s + e.causal_strength, 0) / edges.length;
      scores.set(src, avg * 0.6 + Math.min(edges.length, 10) / 10 * 0.4);
    }
    const topSources = [...scores.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit * 2)
      .map(([id]) => id);

    // N+1: fetch downstream edges per top source node
    const paths: CausalPath[] = [];
    for (const src of topSources.slice(0, limit)) {
      const targets = await this.repo.getCausalEdgesFrom(userId, src);
      for (const t of targets.slice(0, 3)) {
        paths.push({
          node_ids: [src, t.target_node_id],
          segments: [{
            from_node_id: src, to_node_id: t.target_node_id,
            relationship_type: t.relationship_type,
            causal_strength: t.causal_strength, confidence: t.confidence,
          }],
          total_strength: t.causal_strength,
          total_confidence: t.confidence,
          hop_count: 1,
        });
      }
    }

    return paths.sort((a, b) => b.total_strength - a.total_strength).slice(0, limit);
  }
}
