// ============================================================
// graph.traversal.ts — BFS / DFS traversal over graph nodes
// ============================================================

import type { GraphRepository } from './graph.repository';
import type { GraphNode, GraphEdge, TraversalResult, NeighborhoodNode } from './graph.types';

export class GraphTraversal {
  constructor(private readonly repo: GraphRepository) {}

  // ---- Public API -------------------------------------------

  /**
   * BFS from rootId up to `maxDepth` hops.
   * Leverages the recursive Postgres CTE for efficient DB-side traversal.
   */
  async bfs(userId: string, rootId: string, maxDepth = 2): Promise<TraversalResult> {
    const [root, neighbors] = await Promise.all([
      this.repo.getNodeById(rootId, userId),
      this.repo.getNeighborhood(userId, rootId, maxDepth),
    ]);
    if (!root) throw new Error(`Node ${rootId} not found`);

    const neighborIds = neighbors.map(n => n.node.id);
    const allIds = [rootId, ...neighborIds];

    // Fetch all edges in this subgraph in one query
    const edges = await this.getSubgraphEdges(userId, allIds);

    return { root, neighbors, edges };
  }

  /**
   * DFS from rootId collecting nodes up to maxDepth.
   * Pure TypeScript implementation operating on already-fetched data.
   */
  async dfs(userId: string, rootId: string, maxDepth = 2): Promise<TraversalResult> {
    const root = await this.repo.getNodeById(rootId, userId);
    if (!root) throw new Error(`Node ${rootId} not found`);

    const visited   = new Set<string>([rootId]);
    const neighbors: NeighborhoodNode[] = [];
    const edgeSet   = new Map<string, GraphEdge>();

    await this.dfsRecurse(userId, rootId, 0, maxDepth, visited, neighbors, edgeSet, [rootId]);

    return { root, neighbors, edges: Array.from(edgeSet.values()) };
  }

  /**
   * Get the connected component containing rootId.
   * Terminates early once maxNodes is reached to avoid full-graph traversal.
   */
  async getConnectedComponent(userId: string, rootId: string, maxNodes = 500): Promise<GraphNode[]> {
    const visited = new Set<string>([rootId]);
    const queue   = [rootId];
    const result: GraphNode[] = [];

    while (queue.length && result.length < maxNodes) {
      const current = queue.shift()!;
      const node    = await this.repo.getNodeById(current, userId);
      if (node) result.push(node);

      const edges = await this.repo.getEdgesByNode(userId, current, 'both');
      for (const edge of edges) {
        const next = edge.source_node_id === current ? edge.target_node_id : edge.source_node_id;
        if (!visited.has(next)) {
          visited.add(next);
          queue.push(next);
        }
      }
    }
    return result;
  }

  /**
   * Find shortest path between two nodes using BFS.
   * Returns ordered list of node IDs, or null if not reachable.
   */
  async shortestPath(userId: string, fromId: string, toId: string): Promise<string[] | null> {
    if (fromId === toId) return [fromId];

    const visited  = new Set<string>([fromId]);
    const queue: Array<{ id: string; path: string[] }> = [{ id: fromId, path: [fromId] }];

    while (queue.length) {
      const { id, path } = queue.shift()!;
      const edges = await this.repo.getEdgesByNode(userId, id, 'both');

      for (const edge of edges) {
        const next = edge.source_node_id === id ? edge.target_node_id : edge.source_node_id;
        if (next === toId) return [...path, next];
        if (!visited.has(next)) {
          visited.add(next);
          queue.push({ id: next, path: [...path, next] });
        }
      }
    }
    return null;
  }

  // ---- T5: findRelationshipPath() ---------------------------

  /**
   * Find the relationship path between two nodes up to maxDepth hops.
   * Returns path node IDs, edge relationship types along the path,
   * total cumulative edge strength, and hop count.
   */
  async findRelationshipPath(
    userId: string,
    fromId: string,
    toId:   string,
    maxDepth = 4,
  ): Promise<{
    path:          string[];
    edgeTypes:     string[];
    totalStrength: number;
    hopCount:      number;
  } | null> {
    if (fromId === toId) return { path: [fromId], edgeTypes: [], totalStrength: 1, hopCount: 0 };

    const visited = new Set<string>([fromId]);
    const queue: Array<{
      id:        string;
      path:      string[];
      edges:     Array<{ type: string; strength: number }>;
    }> = [{ id: fromId, path: [fromId], edges: [] }];

    while (queue.length) {
      const { id, path, edges } = queue.shift()!;
      if (path.length - 1 >= maxDepth) continue;

      const nodeEdges = await this.repo.getEdgesByNode(userId, id, 'both');
      for (const edge of nodeEdges) {
        const next = edge.source_node_id === id ? edge.target_node_id : edge.source_node_id;
        const nextEdges = [...edges, { type: edge.relationship_type, strength: edge.strength }];

        if (next === toId) {
          const totalStrength = nextEdges.reduce((s, e) => s + e.strength, 0) / nextEdges.length;
          return {
            path:          [...path, next],
            edgeTypes:     nextEdges.map(e => e.type),
            totalStrength: Math.round(totalStrength * 1000) / 1000,
            hopCount:      nextEdges.length,
          };
        }

        if (!visited.has(next)) {
          visited.add(next);
          queue.push({ id: next, path: [...path, next], edges: nextEdges });
        }
      }
    }

    return null; // no path found within maxDepth
  }

  /**
   * Find all nodes reachable from rootId that satisfy a predicate.
   */
  async findReachable(
    userId: string,
    rootId: string,
    predicate: (node: GraphNode) => boolean,
    maxDepth = 3,
  ): Promise<GraphNode[]> {
    const { neighbors } = await this.bfs(userId, rootId, maxDepth);
    return neighbors.map(n => n.node).filter(predicate);
  }

  // ---- Private helpers --------------------------------------

  private async dfsRecurse(
    userId: string,
    nodeId: string,
    depth: number,
    maxDepth: number,
    visited: Set<string>,
    neighbors: NeighborhoodNode[],
    edgeSet: Map<string, GraphEdge>,
    path: string[],
  ): Promise<void> {
    if (depth >= maxDepth) return;

    const edges = await this.repo.getEdgesByNode(userId, nodeId, 'both');
    for (const edge of edges) {
      edgeSet.set(edge.id, edge);
      const next = edge.source_node_id === nodeId ? edge.target_node_id : edge.source_node_id;
      if (!visited.has(next)) {
        visited.add(next);
        const node = await this.repo.getNodeById(next, userId);
        if (node) {
          neighbors.push({ node, depth: depth + 1, path: [...path, next] });
          await this.dfsRecurse(userId, next, depth + 1, maxDepth, visited, neighbors, edgeSet, [...path, next]);
        }
      }
    }
  }

  private async getSubgraphEdges(userId: string, nodeIds: string[]): Promise<GraphEdge[]> {
    const edgeSets = await Promise.all(
      nodeIds.map(id => this.repo.getEdgesByNode(userId, id, 'both')),
    );
    const seen = new Set<string>();
    const result: GraphEdge[] = [];
    for (const edges of edgeSets) {
      for (const e of edges) {
        if (!seen.has(e.id) && nodeIds.includes(e.source_node_id) && nodeIds.includes(e.target_node_id)) {
          seen.add(e.id);
          result.push(e);
        }
      }
    }
    return result;
  }
}
