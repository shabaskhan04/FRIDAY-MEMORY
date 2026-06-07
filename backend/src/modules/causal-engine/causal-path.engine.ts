// ============================================================
// causal-path.engine.ts — Path traversal over causal edges
// ============================================================
import type { CausalRepository } from './causal.repository';
import type {
  CausalPath, CausalPathSegment, RootCauseResult,
  DownstreamEffect, InfluentialNode,
} from './causal.types';

const MAX_DEPTH = 5;

export class CausalPathEngine {
  constructor(
    private readonly repo: CausalRepository,
    private readonly getNodeName: (userId: string, nodeId: string) => Promise<string>,
  ) {}

  // ---- findCausalPath() ------------------------------------
  // BFS from source to target following causal edges forward.

  async findCausalPath(
    userId: string,
    fromNodeId: string,
    toNodeId:   string,
  ): Promise<CausalPath | null> {
    if (fromNodeId === toNodeId) return trivialPath(fromNodeId);

    const visited = new Set<string>([fromNodeId]);
    type QueueItem = { id: string; segments: CausalPathSegment[]; ids: string[] };
    const queue: QueueItem[] = [{ id: fromNodeId, segments: [], ids: [fromNodeId] }];

    while (queue.length) {
      const { id, segments, ids } = queue.shift()!;
      if (ids.length - 1 >= MAX_DEPTH) continue;

      const edges = await this.repo.getCausalEdgesFrom(userId, id);
      for (const edge of edges) {
        const seg: CausalPathSegment = {
          from_node_id:    id,
          to_node_id:      edge.target_node_id,
          relationship_type: edge.relationship_type,
          causal_strength: edge.causal_strength,
          confidence:      edge.confidence,
        };
        const newSegments = [...segments, seg];
        const newIds      = [...ids, edge.target_node_id];

        if (edge.target_node_id === toNodeId) {
          return buildPath(newIds, newSegments);
        }
        if (!visited.has(edge.target_node_id)) {
          visited.add(edge.target_node_id);
          queue.push({ id: edge.target_node_id, segments: newSegments, ids: newIds });
        }
      }
    }
    return null;
  }

  // ---- findRootCauses() ------------------------------------
  // Walk backward (inbound causal edges) from effectNodeId.

  async findRootCauses(
    userId: string,
    effectNodeId: string,
    maxDepth = MAX_DEPTH,
  ): Promise<RootCauseResult[]> {
    const results: RootCauseResult[] = [];
    await this.walkBackward(userId, effectNodeId, [], [effectNodeId], maxDepth, results);

    const named = await Promise.all(results.map(async r => ({
      ...r,
      root_node_name: await this.getNodeName(userId, r.root_node_id),
    })));
    return named.sort((a, b) => b.influence_score - a.influence_score);
  }

  // ---- findDownstreamEffects() -----------------------------
  // Walk forward (outbound causal edges) from causeNodeId.

  async findDownstreamEffects(
    userId: string,
    causeNodeId: string,
    maxDepth = MAX_DEPTH,
  ): Promise<DownstreamEffect[]> {
    const results: DownstreamEffect[] = [];
    await this.walkForward(userId, causeNodeId, [], [causeNodeId], maxDepth, results);

    const named = await Promise.all(results.map(async r => ({
      ...r,
      effect_node_name: await this.getNodeName(userId, r.effect_node_id),
    })));
    return named.sort((a, b) => b.impact_score - a.impact_score);
  }

  // ---- findMostInfluentialNodes() -------------------------

  async findMostInfluentialNodes(userId: string, limit = 10): Promise<InfluentialNode[]> {
    const allEdges = await this.repo.getAllCausalEdges(userId);
    const nodeMap  = new Map<string, { count: number; totalStrength: number }>();

    for (const edge of allEdges) {
      const src = nodeMap.get(edge.source_node_id) ?? { count: 0, totalStrength: 0 };
      src.count++;
      src.totalStrength += edge.causal_strength;
      nodeMap.set(edge.source_node_id, src);
    }

    const nodes = await Promise.all(
      Array.from(nodeMap.entries()).map(async ([nodeId, stats]) => {
        const avg = stats.totalStrength / stats.count;
        return {
          node_id:               nodeId,
          node_name:             await this.getNodeName(userId, nodeId),
          outbound_causal_edges: stats.count,
          avg_causal_strength:   avg,
          influence_score:       Math.min(1, avg * 0.6 + Math.min(stats.count, 10) / 10 * 0.4),
        };
      }),
    );

    return nodes.sort((a, b) => b.influence_score - a.influence_score).slice(0, limit);
  }

  // ---- Private iterative walkers ---------------------------

  private async walkBackward(
    userId: string,
    nodeId: string,
    segments: CausalPathSegment[],
    ids: string[],
    depth: number,
    results: RootCauseResult[],
  ): Promise<void> {
    // H-2: iterative BFS with Set cycle guard (was recursive + ids.includes O(depth))
    type Item = { nodeId: string; segments: CausalPathSegment[]; ids: string[]; depth: number };
    const queue: Item[] = [{ nodeId, segments, ids, depth }];

    while (queue.length) {
      const item = queue.shift()!;
      const incoming = item.depth > 0
        ? await this.repo.getCausalEdgesTo(userId, item.nodeId)
        : [];

      if (!incoming.length || item.depth === 0) {
        if (item.ids.length > 1) {
          const path = buildPath([...item.ids].reverse(), [...item.segments].reverse());
          results.push({
            root_node_id:    item.ids[item.ids.length - 1],
            root_node_name:  '',
            path,
            influence_score: path.total_strength,
          });
        }
        continue;
      }

      const visited = new Set(item.ids);
      for (const edge of incoming) {
        if (visited.has(edge.source_node_id)) continue; // O(1) cycle guard
        const seg: CausalPathSegment = {
          from_node_id:    edge.source_node_id,
          to_node_id:      item.nodeId,
          relationship_type: edge.relationship_type,
          causal_strength: edge.causal_strength,
          confidence:      edge.confidence,
        };
        queue.push({
          nodeId:   edge.source_node_id,
          segments: [seg, ...item.segments],
          ids:      [...item.ids, edge.source_node_id],
          depth:    item.depth - 1,
        });
      }
    }
  }

  private async walkForward(
    userId: string,
    nodeId: string,
    segments: CausalPathSegment[],
    ids: string[],
    depth: number,
    results: DownstreamEffect[],
  ): Promise<void> {
    // H-2: iterative BFS with Set cycle guard (was recursive + ids.includes O(depth))
    type Item = { nodeId: string; segments: CausalPathSegment[]; ids: string[]; depth: number };
    const queue: Item[] = [{ nodeId, segments, ids, depth }];

    while (queue.length) {
      const item = queue.shift()!;
      const outgoing = item.depth > 0
        ? await this.repo.getCausalEdgesFrom(userId, item.nodeId)
        : [];

      if (!outgoing.length || item.depth === 0) {
        if (item.ids.length > 1) {
          const path = buildPath(item.ids, item.segments);
          results.push({
            effect_node_id:   item.ids[item.ids.length - 1],
            effect_node_name: '',
            path,
            impact_score:     path.total_strength,
          });
        }
        continue;
      }

      const visited = new Set(item.ids);
      for (const edge of outgoing) {
        if (visited.has(edge.target_node_id)) continue; // O(1) cycle guard
        const seg: CausalPathSegment = {
          from_node_id:    item.nodeId,
          to_node_id:      edge.target_node_id,
          relationship_type: edge.relationship_type,
          causal_strength: edge.causal_strength,
          confidence:      edge.confidence,
        };
        queue.push({
          nodeId:   edge.target_node_id,
          segments: [...item.segments, seg],
          ids:      [...item.ids, edge.target_node_id],
          depth:    item.depth - 1,
        });
      }
    }
  }
}

// ---- Path construction helpers ---------------------------

function geoMean(values: number[]): number {
  if (!values.length) return 0;
  const product = values.reduce((p, v) => p * Math.max(0.001, v), 1);
  return Math.pow(product, 1 / values.length);
}

function buildPath(ids: string[], segments: CausalPathSegment[]): CausalPath {
  return {
    node_ids:         ids,
    segments,
    total_strength:   geoMean(segments.map(s => s.causal_strength)),
    total_confidence: geoMean(segments.map(s => s.confidence)),
    hop_count:        segments.length,
  };
}

function trivialPath(nodeId: string): CausalPath {
  return { node_ids: [nodeId], segments: [], total_strength: 1, total_confidence: 1, hop_count: 0 };
}
