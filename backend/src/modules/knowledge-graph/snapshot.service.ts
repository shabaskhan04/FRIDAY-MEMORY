// ============================================================
// snapshot.service.ts — P2: Graph snapshots with comparison
// ============================================================

import type { GraphRepository } from './graph.repository';
import type {
  GraphSnapshot, GraphNode, SnapshotSummaryNode, SnapshotComparison,
} from './graph.types';

const TOP_N = 10;

export class SnapshotService {
  constructor(private readonly repo: GraphRepository) {}

  // ---- Create ---------------------------------------------

  async createSnapshot(userId: string, trigger = 'manual'): Promise<GraphSnapshot> {
    // Fetch full graph state
    const [importantNodes, projects, people, goals] = await Promise.all([
      this.repo.getMostImportantNodes(userId, TOP_N),
      this.repo.getNodesByType(userId, 'PROJECT', TOP_N),
      this.repo.getNodesByType(userId, 'PERSON',  TOP_N),
      this.repo.getNodesByType(userId, 'GOAL',    TOP_N),
    ]);

    const toSummary = (nodes: GraphNode[]): SnapshotSummaryNode[] =>
      nodes.map(n => ({ id: n.id, name: n.name, node_type: n.node_type, importance_score: n.importance_score }));

    return this.repo.createStructuredSnapshot(userId, trigger, {
      top_entities: toSummary(importantNodes),
      top_projects: toSummary(projects),
      top_people:   toSummary(people),
      top_goals:    toSummary(goals),
    });
  }

  // ---- Retrieval ------------------------------------------

  async getSnapshot(userId: string, snapshotId: string): Promise<GraphSnapshot | null> {
    return this.repo.getSnapshotById(userId, snapshotId);
  }

  async getSnapshots(userId: string, limit = 20): Promise<GraphSnapshot[]> {
    return this.repo.getSnapshots(userId, limit);
  }

  // ---- Comparison -----------------------------------------

  /**
   * compareSnapshots() — computes structural diff between two graph states.
   *
   * Returns:
   *   nodes_added / nodes_removed
   *   edges_added / edges_removed
   *   emerging_entities  — nodes new to "to" snapshot with importance > average
   *   declining_entities — nodes in both snapshots whose importance dropped > 0.1
   */
  async compareSnapshots(
    userId: string,
    fromId: string,
    toId:   string,
  ): Promise<SnapshotComparison> {
    const [from, to] = await Promise.all([
      this.repo.getSnapshotById(userId, fromId),
      this.repo.getSnapshotById(userId, toId),
    ]);
    if (!from) throw new Error(`Snapshot ${fromId} not found`);
    if (!to)   throw new Error(`Snapshot ${toId} not found`);

    const fromNodeIds = new Set<string>(from.snapshot.nodes.map((n: GraphNode) => n.id));
    const toNodeIds   = new Set<string>(to.snapshot.nodes.map((n: GraphNode) => n.id));
    const fromEdgeIds = new Set<string>(from.snapshot.edges.map((e: any) => e.id));
    const toEdgeIds   = new Set<string>(to.snapshot.edges.map((e: any) => e.id));

    const addedNodeIds   = [...toNodeIds].filter(id => !fromNodeIds.has(id));
    const removedNodeIds = [...fromNodeIds].filter(id => !toNodeIds.has(id));

    const toNodes = to.snapshot.nodes as GraphNode[];
    const avgImportance = toNodes.reduce((s, n) => s + n.importance_score, 0) / Math.max(toNodes.length, 1);

    // Emerging: new nodes with above-average importance
    const emerging: SnapshotSummaryNode[] = toNodes
      .filter(n => addedNodeIds.includes(n.id) && n.importance_score > avgImportance)
      .map(n => ({ id: n.id, name: n.name, node_type: n.node_type, importance_score: n.importance_score }));

    // Declining: in both, but importance dropped >= 0.1
    const fromImportanceMap = new Map<string, number>(
      (from.snapshot.nodes as GraphNode[]).map(n => [n.id, n.importance_score]),
    );
    const declining: SnapshotSummaryNode[] = toNodes
      .filter(n => {
        const prev = fromImportanceMap.get(n.id);
        return prev !== undefined && prev - n.importance_score >= 0.1;
      })
      .map(n => ({ id: n.id, name: n.name, node_type: n.node_type, importance_score: n.importance_score }));

    return {
      from_snapshot_id:   fromId,
      to_snapshot_id:     toId,
      from_date:          from.created_at,
      to_date:            to.created_at,
      nodes_added:        addedNodeIds.length,
      nodes_removed:      removedNodeIds.length,
      edges_added:        [...toEdgeIds].filter(id => !fromEdgeIds.has(id)).length,
      edges_removed:      [...fromEdgeIds].filter(id => !toEdgeIds.has(id)).length,
      emerging_entities:  emerging,
      declining_entities: declining,
    };
  }
}
