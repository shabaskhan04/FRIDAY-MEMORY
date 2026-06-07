// ============================================================
// confidence.engine.ts — P6: Explainable confidence tracking
// ============================================================

import type { GraphRepository } from './graph.repository';
import type { GraphNode, GraphEdge, ConfidenceBreakdown } from './graph.types';

// ---- Constants -------------------------------------------
const MAX_SOURCES   = 20;   // beyond this, fully confident on source_count
const MENTION_CAP   = 100;
const STABILITY_WINDOW_DAYS = 30;

export class ConfidenceEngine {
  constructor(private readonly repo: GraphRepository) {}

  // ---- Node confidence -------------------------------------

  /**
   * calculateNodeConfidence()
   *
   * source_count       → 0.35  how many distinct memories reference this node
   * mention_frequency  → 0.30  log-normalised mention count
   * consistency_score  → 0.20  whether aliases and type have been stable
   * stability_score    → 0.15  node hasn't been updated/merged erratically
   *
   * All factors 0–1, weighted sum = final_confidence.
   */
  calculateNodeConfidence(node: GraphNode, recentUpdateCount = 0): ConfidenceBreakdown {
    const source_count_score = Math.min(1, node.source_count / MAX_SOURCES);

    const mention_frequency = Math.log1p(Math.min(node.mention_count, MENTION_CAP))
      / Math.log1p(MENTION_CAP);

    // Consistency: penalise nodes with many aliases (likely merged fragmented data)
    const consistency_score = Math.max(0, 1 - node.aliases.length * 0.05);

    // Stability: penalise nodes updated > 3 times in stability window (erratic)
    const stability_score = Math.max(0, 1 - Math.max(0, recentUpdateCount - 3) * 0.1);

    const final_confidence = Math.min(1, Math.max(0,
      source_count_score * 0.45 +
      mention_frequency  * 0.35 +
      consistency_score  * 0.12 +
      stability_score    * 0.08,
    ));

    return {
      source_count:      source_count_score,
      mention_frequency,
      consistency_score,
      stability_score,
      final_confidence,
    };
  }

  // ---- Edge confidence -------------------------------------

  /**
   * calculateEdgeConfidence()
   *
   * source_count       → 0.40  distinct memories that mention this relationship
   * mention_frequency  → 0.30  how often the edge is re-mentioned
   * consistency_score  → 0.15  relationship_type hasn't flip-flopped
   * stability_score    → 0.15  strength hasn't oscillated
   */
  calculateEdgeConfidence(edge: GraphEdge, strengthHistory: number[] = []): ConfidenceBreakdown {
    const source_count_score = Math.min(1, edge.source_count / MAX_SOURCES);

    const mention_frequency = Math.log1p(Math.min(edge.mention_count, MENTION_CAP))
      / Math.log1p(MENTION_CAP);

    // Consistency: if strength has been high consistently vs oscillating
    const consistency_score = strengthHistory.length < 2
      ? edge.strength
      : this.strengthConsistency(strengthHistory);

    // Stability: recent strength vs. baseline (pinned = maximally stable)
    const stability_score = edge.is_pinned ? 1.0 : Math.min(1, edge.strength + 0.1);

    const final_confidence = Math.min(1, Math.max(0,
      source_count_score * 0.40 +
      mention_frequency  * 0.30 +
      consistency_score  * 0.15 +
      stability_score    * 0.15,
    ));

    return {
      source_count:      source_count_score,
      mention_frequency,
      consistency_score,
      stability_score,
      final_confidence,
    };
  }

  // ---- Batch update ----------------------------------------

  /**
   * updateConfidenceScores() — recompute and persist confidence_score
   * for all nodes and their edges. Call after bulk ingestion or on schedule.
   */
  async updateConfidenceScores(userId: string, nodeIds?: string[]): Promise<void> {
    const nodes = nodeIds
      ? await Promise.all(nodeIds.map(id => this.repo.getNodeById(id, userId)))
          .then(ns => ns.filter((n): n is GraphNode => n !== null))
      : await this.repo.getMostImportantNodes(userId, 500);

    // Get event counts for stability within last 30 days
    const events = await this.repo.getRecentEvents(userId, 1000);
    const cutoff  = Date.now() - STABILITY_WINDOW_DAYS * 86_400_000;
    const recentUpdatesByNode = new Map<string, number>();
    for (const ev of events) {
      if (!ev.entity_id || new Date(ev.created_at).getTime() < cutoff) continue;
      if (ev.event_type === 'NODE_UPDATED') {
        recentUpdatesByNode.set(ev.entity_id, (recentUpdatesByNode.get(ev.entity_id) ?? 0) + 1);
      }
    }

    await Promise.all(nodes.map(async (node) => {
      const recentUpdates = recentUpdatesByNode.get(node.id) ?? 0;
      const { final_confidence } = this.calculateNodeConfidence(node, recentUpdates);

      // Only write if changed > 0.01 to avoid noisy updates
      if (Math.abs(final_confidence - node.confidence_score) > 0.01) {
        await this.repo.updateNode(node.id, userId, { confidence_score: final_confidence });
        await this.repo.logEvent(userId, 'SCORE_UPDATED', node.id, 'node', { confidence_score: final_confidence });
      }

      // Update edges from this node
      const edges = await this.repo.getEdgesByNode(userId, node.id, 'outbound');
      for (const edge of edges.filter(e => !e.is_archived)) {
        const { final_confidence: edgeConf } = this.calculateEdgeConfidence(edge);
        if (Math.abs(edgeConf - edge.confidence) > 0.01) {
          await this.repo.updateEdgeStrength(edge.id, userId, edge.strength); // triggers updated_at
          await this.repo.logEvent(userId, 'SCORE_UPDATED', edge.id, 'edge', { confidence: edgeConf });
        }
      }
    }));
  }

  // ---- Private helpers ------------------------------------

  /** Coefficient of variation — low variance = high consistency */
  private strengthConsistency(history: number[]): number {
    const mean = history.reduce((s, v) => s + v, 0) / history.length;
    if (mean === 0) return 0;
    const variance = history.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / history.length;
    const cv = Math.sqrt(variance) / mean;
    return Math.max(0, 1 - cv);  // CV=0 → 1.0 (perfectly stable), CV=1 → 0.0
  }
}
