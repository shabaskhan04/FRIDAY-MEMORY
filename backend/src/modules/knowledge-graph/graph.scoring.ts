// ============================================================
// graph.scoring.ts — Temporal scoring & importance algorithms
// ============================================================

import type { GraphNode, GraphEdge, ScoringContext, ScoreBreakdown } from './graph.types';

// ---- Constants ------------------------------------------------

const FREQUENCY_CAP    = 100;  // cap for log-normalized frequency
const CONNECTIVITY_CAP = 50;   // max edges considered for connectivity

// ============================================================
// T1 — Flat recency model (replaces exponential decay)
// ============================================================

/**
 * Flat recency multiplier for edges.
 *
 * Rules:
 *  - Pinned edges always return 1.0 (never decay)
 *  - Edges updated within 30 days return 1.0
 *  - Edges older than 30 days return 0.9
 *
 * Long-term relationships remain stable — no compounding decay.
 */
export function getEdgeRecencyMultiplier(
  daysSinceUpdated: number,
  isPinned: boolean,
): number {
  if (isPinned) return 1.0;
  if (daysSinceUpdated <= 30) return 1.0;
  return 0.9;
}

/**
 * Node recency score (used in importance scoring, not edge decay).
 * Kept simple: recent = 1.0, older fades linearly over 90 days.
 */
export function nodeRecencyScore(lastMentionedAt: Date): number {
  const daysSince = (Date.now() - lastMentionedAt.getTime()) / 86_400_000;
  return Math.max(0, 1 - daysSince / 90);
}

// ============================================================
// T2 — calculateGraphScore()
// ============================================================

export interface GraphScoreInput {
  importanceScore:     number;  // 0–1, pre-computed node importance
  edgeStrength:        number;  // 0–1, average active edge strength
  degree:              number;  // raw edge count for this node
  daysSinceLastUpdate: number;  // for recency multiplier
  isPinned?:           boolean; // if the primary edge is pinned
}

/**
 * Composite graph score combining importance, edge strength, degree, recency.
 *
 * Formula:
 *   graphScore = importanceScore   * 0.4
 *              + edgeStrength      * 0.3
 *              + normalizedDegree  * 0.2
 *              + recencyMultiplier * 0.1
 *
 * normalizedDegree = min(degree, CONNECTIVITY_CAP) / CONNECTIVITY_CAP
 * recencyMultiplier = getEdgeRecencyMultiplier(daysSince, isPinned)
 *
 * Result is clamped to [0, 1].
 */
export function calculateGraphScore(input: GraphScoreInput): number {
  const normalizedDegree  = Math.min(input.degree, CONNECTIVITY_CAP) / CONNECTIVITY_CAP;
  const recencyMultiplier = getEdgeRecencyMultiplier(
    input.daysSinceLastUpdate,
    input.isPinned ?? false,
  );

  const score =
    input.importanceScore * 0.4 +
    input.edgeStrength    * 0.3 +
    normalizedDegree      * 0.2 +
    recencyMultiplier     * 0.1;

  return Math.min(1, Math.max(0, score));
}

// ============================================================
// Existing helpers (kept, updated to use flat recency)
// ============================================================

export function frequencyScore(mentionCount: number): number {
  return Math.log1p(Math.min(mentionCount, FREQUENCY_CAP)) / Math.log1p(FREQUENCY_CAP);
}

export function connectivityScore(edgeCount: number, avgEdgeStrength: number): number {
  const normalized = Math.min(edgeCount, CONNECTIVITY_CAP) / CONNECTIVITY_CAP;
  return normalized * avgEdgeStrength;
}

export function computeImportanceScore(ctx: ScoringContext): ScoreBreakdown {
  const recency_score      = nodeRecencyScore(ctx.last_mentioned_at);
  const frequency_score    = frequencyScore(ctx.mention_count);
  const connectivity_score = connectivityScore(ctx.edge_count, ctx.avg_edge_strength);

  const final_importance = Math.min(1, Math.max(0,
    0.40 * recency_score +
    0.35 * frequency_score +
    0.25 * connectivity_score,
  ));

  return { recency_score, frequency_score, connectivity_score, final_importance };
}

/**
 * Apply flat recency multiplier to an edge.
 * Pinned edges are never decayed.
 */
export function decayEdgeStrength(edge: GraphEdge): number {
  const daysSince = (Date.now() - new Date(edge.last_seen_at).getTime()) / 86_400_000;
  const multiplier = getEdgeRecencyMultiplier(daysSince, edge.is_pinned ?? false);
  return Math.max(0.05, edge.strength * multiplier);
}

export function boostEdgeStrength(currentStrength: number, k = 0.15): number {
  return Math.min(1, currentStrength + (1 - currentStrength) * k);
}

// ============================================================
// Batch helpers
// ============================================================

export interface NodeScoringInput {
  node: GraphNode;
  edges: GraphEdge[];
}

export function scoreNode(input: NodeScoringInput): ScoreBreakdown {
  const activeEdges = input.edges.filter(e => !e.is_archived);
  const avgStrength = activeEdges.length
    ? activeEdges.reduce((s, e) => s + e.strength, 0) / activeEdges.length
    : 0;

  return computeImportanceScore({
    mention_count:     input.node.mention_count,
    last_mentioned_at: new Date(input.node.last_mentioned_at),
    edge_count:        activeEdges.length,
    avg_edge_strength: avgStrength,
  });
}

export function rankNodes(
  inputs: NodeScoringInput[],
): Array<NodeScoringInput & { score: ScoreBreakdown }> {
  return inputs
    .map(i => ({ ...i, score: scoreNode(i) }))
    .sort((a, b) => b.score.final_importance - a.score.final_importance);
}

export function detectRisingNodes(
  current:   Array<{ id: string; importance_score: number }>,
  previous:  Array<{ id: string; importance_score: number }>,
  threshold = 0.15,
): string[] {
  const prevMap = new Map(previous.map(n => [n.id, n.importance_score]));
  return current
    .filter(n => (n.importance_score - (prevMap.get(n.id) ?? 0)) >= threshold)
    .map(n => n.id);
}
