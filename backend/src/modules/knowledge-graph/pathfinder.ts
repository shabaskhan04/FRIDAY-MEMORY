// ============================================================
// pathfinder.ts — Graph path finding with node-name resolution
//
// Sits above GraphTraversal (which operates on IDs) and
// GraphSearch (which locates nodes by name), providing a
// human-friendly API:  findShortestPath(userId, "Sarah", "Khan Designs")
// ============================================================

import type { GraphRepository } from './graph.repository';
import type { GraphTraversal }  from './graph.traversal';
import type { GraphSearch }     from './graph.search';
import type { GraphNode, GraphEdge, PathResult, PathStep } from './graph.types';

const NOT_FOUND: PathResult = {
  found: false, source: null, target: null,
  steps: [], node_ids: [], edge_types: [],
  hop_count: 0, avg_strength: 0, total_strength: 0, path_confidence: 0, summary: '',
};

export class GraphPathfinder {
  constructor(
    private readonly repo:      GraphRepository,
    private readonly traversal: GraphTraversal,
    private readonly search:    GraphSearch,
  ) {}

  // ---- Public API -------------------------------------------

  /**
   * Find shortest path between two entity names.
   * Resolves names → node IDs, runs BFS, hydrates full PathResult.
   */
  async findShortestPath(
    userId:   string,
    sourceName: string,
    targetName: string,
    maxDepth  = 6,
  ): Promise<PathResult> {
    console.log('[pathfinder] findShortestPath', { sourceName, targetName, maxDepth });

    const [sourceNode, targetNode] = await Promise.all([
      this.search.findByName(userId, sourceName),
      this.search.findByName(userId, targetName),
    ]);

    if (!sourceNode) {
      console.log('[pathfinder] source node not found:', sourceName);
      return NOT_FOUND;
    }
    if (!targetNode) {
      console.log('[pathfinder] target node not found:', targetName);
      return NOT_FOUND;
    }

    return this.findShortestPathById(userId, sourceNode.id, targetNode.id, maxDepth);
  }

  /**
   * Find shortest path between two node IDs.
   * Returns a fully hydrated PathResult including per-step edges.
   */
  async findShortestPathById(
    userId:   string,
    sourceId: string,
    targetId: string,
    maxDepth  = 6,
  ): Promise<PathResult> {
    const raw = await this.traversal.findRelationshipPath(userId, sourceId, targetId, maxDepth);

    if (!raw) {
      const [source, target] = await Promise.all([
        this.repo.getNodeById(sourceId, userId),
        this.repo.getNodeById(targetId, userId),
      ]);
      console.log('[pathfinder] no path found between', sourceId, targetId);
      return { ...NOT_FOUND, source, target };
    }

    // Hydrate: resolve every node ID in the path to a GraphNode
    const nodes = await Promise.all(raw.path.map(id => this.repo.getNodeById(id, userId)));
    if (nodes.some(n => n === null)) {
      console.log('[pathfinder] path hydration failed — missing node in path');
      return NOT_FOUND;
    }
    const resolvedNodes = nodes as GraphNode[];

    // Fetch the edge between each consecutive pair in the path
    const edgePromises: Promise<GraphEdge | null>[] = [];
    for (let i = 0; i < raw.path.length - 1; i++) {
      edgePromises.push(this.resolveEdgeBetween(userId, raw.path[i], raw.path[i + 1]));
    }
    const resolvedEdges = await Promise.all(edgePromises);

    // Build steps
    const steps: PathStep[] = resolvedNodes.map((node, i) => ({
      node,
      edge_to_next:      resolvedEdges[i] ?? null,
      relationship_type: raw.edgeTypes[i] ?? null,
    }));

    // Build human-readable summary
    const summary = steps
      .map((step, i) => {
        if (!step.edge_to_next) return step.node.name;
        const edge    = step.edge_to_next;
        const relType = step.relationship_type ?? edge.relationship_type;
        // Indicate edge direction relative to path
        if (edge.source_node_id === step.node.id) {
          return `${step.node.name} --[${relType}]-->`;
        }
        return `${step.node.name} <--[${relType}]--`;
      })
      .join(' ');

    console.log('[pathfinder] path found:', summary);

    const activeEdges = resolvedEdges.filter((e): e is GraphEdge => e !== null);
    const total_strength  = activeEdges.reduce((s, e) => s + e.strength, 0);
    const path_confidence = activeEdges.length
      ? activeEdges.reduce((s, e) => s + e.confidence, 0) / activeEdges.length
      : 0;

    return {
      found:           true,
      source:          resolvedNodes[0],
      target:          resolvedNodes[resolvedNodes.length - 1],
      steps,
      node_ids:        raw.path,
      edge_types:      raw.edgeTypes,
      hop_count:       raw.hopCount,
      avg_strength:    raw.totalStrength,   // avg from traversal
      total_strength:  Math.round(total_strength  * 1000) / 1000,
      path_confidence: Math.round(path_confidence * 1000) / 1000,
      summary,
    };
  }

  // ---- Private helpers --------------------------------------

  /**
   * Fetches the edge between two adjacent nodes.
   * Tries both directions since edges are stored directionally.
   */
  private async resolveEdgeBetween(
    userId: string,
    aId:    string,
    bId:    string,
  ): Promise<GraphEdge | null> {
    const fwd = await this.repo.getEdgeBetween(userId, aId, bId);
    if (fwd) return fwd;
    return this.repo.getEdgeBetween(userId, bId, aId);
  }
}
