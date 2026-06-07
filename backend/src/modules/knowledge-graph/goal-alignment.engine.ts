// ============================================================
// goal-alignment.engine.ts — P4: Does activity support goals?
// Pure graph analytics. No LLM.
// ============================================================

import type { GraphRepository } from './graph.repository';
import type {
  GraphNode, GraphEdge, RelationshipType,
  GoalAlignmentResult, ProjectAlignmentResult,
} from './graph.types';

const ALIGNMENT_RELS:  RelationshipType[] = ['ALIGNS_WITH', 'CONTRIBUTES_TO', 'GOAL_OF'];
const DISTRACTOR_RELS: RelationshipType[] = ['DISTRACTS_FROM'];

export class GoalAlignmentEngine {
  constructor(private readonly repo: GraphRepository) {}

  // ---- Per-goal analysis -----------------------------------

  /**
   * calculateGoalAlignment() — for a single GOAL node, computes:
   *   contributors:    nodes with ALIGNS_WITH / CONTRIBUTES_TO / GOAL_OF edges to this goal
   *   detractors:      nodes with DISTRACTS_FROM edges to this goal
   *   alignment_score: (contributor_strength_sum - detractor_strength_sum) normalised to 0–1
   */
  async calculateGoalAlignment(userId: string, goalId: string): Promise<GoalAlignmentResult> {
    const goal = await this.repo.getNodeById(goalId, userId);
    if (!goal || goal.node_type !== 'GOAL') throw new Error(`Node ${goalId} is not a GOAL`);

    const edges = await this.repo.getEdgesByNode(userId, goalId, 'inbound');

    const contributors: GoalAlignmentResult['contributors'] = [];
    const detractors:   GoalAlignmentResult['detractors']   = [];

    for (const edge of edges.filter(e => !e.is_archived)) {
      const node = await this.repo.getNodeById(edge.source_node_id, userId);
      if (!node) continue;

      if (ALIGNMENT_RELS.includes(edge.relationship_type)) {
        contributors.push({ node, strength: edge.strength, rel_type: edge.relationship_type });
      } else if (DISTRACTOR_RELS.includes(edge.relationship_type)) {
        detractors.push({ node, strength: edge.strength, rel_type: edge.relationship_type });
      }
    }

    const contribSum   = contributors.reduce((s, c) => s + c.strength, 0);
    const detractSum   = detractors.reduce((s, d) => s + d.strength, 0);
    const total        = contribSum + detractSum;
    const alignment_score = total === 0 ? 0 : Math.max(0, (contribSum - detractSum) / total);

    return { goal_id: goalId, goal_name: goal.name, contributors, detractors, alignment_score };
  }

  /**
   * getGoalContributors() — nodes most actively supporting a goal, ranked by strength.
   */
  async getGoalContributors(
    userId: string,
    goalId: string,
  ): Promise<Array<{ node: GraphNode; strength: number; rel_type: RelationshipType }>> {
    const { contributors } = await this.calculateGoalAlignment(userId, goalId);
    return contributors.sort((a, b) => b.strength - a.strength);
  }

  /**
   * getGoalDetractors() — nodes with DISTRACTS_FROM edges to the goal.
   */
  async getGoalDetractors(
    userId: string,
    goalId: string,
  ): Promise<Array<{ node: GraphNode; strength: number; rel_type: RelationshipType }>> {
    const { detractors } = await this.calculateGoalAlignment(userId, goalId);
    return detractors.sort((a, b) => b.strength - a.strength);
  }

  /**
   * getAllGoalAlignments() — run calculateGoalAlignment for every GOAL in the graph.
   * Returns sorted by alignment_score descending.
   */
  async getAllGoalAlignments(userId: string): Promise<GoalAlignmentResult[]> {
    const goals   = await this.repo.getNodesByType(userId, 'GOAL', 50);
    const results = await Promise.all(goals.map(g => this.calculateGoalAlignment(userId, g.id)));
    return results.sort((a, b) => b.alignment_score - a.alignment_score);
  }

  /**
   * getProjectAlignment() — for a PROJECT node, finds which GOAL nodes it supports,
   * via CONTRIBUTES_TO / ALIGNS_WITH outbound edges, or via traversal depth ≤ 2.
   */
  async getProjectAlignment(userId: string, projectId: string): Promise<ProjectAlignmentResult> {
    const project = await this.repo.getNodeById(projectId, userId);
    if (!project) throw new Error(`Node ${projectId} not found`);

    const edges = await this.repo.getEdgesByNode(userId, projectId, 'outbound');
    const directGoals = new Map<string, { goal: GraphNode; path_length: number }>();

    for (const edge of edges.filter(e => !e.is_archived && ALIGNMENT_RELS.includes(e.relationship_type))) {
      const target = await this.repo.getNodeById(edge.target_node_id, userId);
      if (target?.node_type === 'GOAL') {
        directGoals.set(target.id, { goal: target, path_length: 1 });
      }
    }

    // Depth-2: check what project's direct neighbors connect to
    const depth1Edges = await this.repo.getEdgesByNode(userId, projectId, 'both');
    for (const e of depth1Edges.filter(e => !e.is_archived)) {
      const mid = await this.repo.getNodeById(
        e.source_node_id === projectId ? e.target_node_id : e.source_node_id,
        userId,
      );
      if (!mid) continue;
      const midEdges = await this.repo.getEdgesByNode(userId, mid.id, 'outbound');
      for (const me of midEdges.filter(me => !me.is_archived && ALIGNMENT_RELS.includes(me.relationship_type))) {
        const goal = await this.repo.getNodeById(me.target_node_id, userId);
        if (goal?.node_type === 'GOAL' && !directGoals.has(goal.id)) {
          directGoals.set(goal.id, { goal, path_length: 2 });
        }
      }
    }

    const aligned_goals = Array.from(directGoals.values()).sort((a, b) => a.path_length - b.path_length);
    const alignment_score = aligned_goals.length > 0
      ? Math.min(1, aligned_goals.filter(g => g.path_length === 1).length * 0.4 + aligned_goals.length * 0.1)
      : 0;

    return { project_id: projectId, project_name: project.name, aligned_goals, alignment_score };
  }
}
