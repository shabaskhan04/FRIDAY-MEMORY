// ============================================================
// graph.insights.ts — 7 pure graph analytics insight engines
// No LLM calls. No external dependencies.
// ============================================================

import type { GraphRepository } from './graph.repository';
import type { GraphInsight, InsightType, GraphNode } from './graph.types';
import { calculateGraphScore } from './graph.scoring';

export class GraphInsights {
  constructor(private readonly repo: GraphRepository) {}

  // ---- Orchestrator ----------------------------------------

  async generateInsights(userId: string): Promise<GraphInsight[]> {
    const [a, b, c, d, e, f, g] = await Promise.all([
      this.getEmergingEntities(userId),
      this.getNeglectedGoals(userId),
      this.getGrowingProjects(userId),
      this.getDisconnectedProjects(userId),
      this.getImportantPeople(userId),
      this.getRelationshipChanges(userId),
      this.getMostConnectedConcepts(userId),
    ]);

    return [...a, ...b, ...c, ...d, ...e, ...f, ...g]
      .sort((x, y) => y.score - x.score);
  }

  // ---- 1. getEmergingEntities --------------------------------
  // Nodes whose importance_score exceeds the user's average by > 20%
  // AND were created in the last 30 days.

  async getEmergingEntities(userId: string): Promise<GraphInsight[]> {
    const all = await this.repo.getMostImportantNodes(userId, 200);
    if (!all.length) return [];

    const avg      = all.reduce((s, n) => s + n.importance_score, 0) / all.length;
    const cutoff   = new Date(Date.now() - 30 * 86_400_000);
    const emerging = all.filter(n =>
      n.importance_score > avg + 0.2 &&
      new Date(n.created_at) >= cutoff,
    );

    if (!emerging.length) return [];

    return [{
      type:         'EMERGING_ENTITY',
      title:        'Emerging entities',
      description:  `${emerging.slice(0, 3).map(n => n.name).join(', ')} are new and already above-average importance.`,
      entity_ids:   emerging.map(n => n.id),
      score:        Math.min(1, avg + 0.3),
      generated_at: new Date().toISOString(),
    }];
  }

  // ---- 2. getNeglectedGoals ----------------------------------
  // GOAL nodes with last_mentioned_at > 14 days ago, sorted by staleness.

  async getNeglectedGoals(userId: string): Promise<GraphInsight[]> {
    const goals     = await this.repo.getNodesByType(userId, 'GOAL', 50);
    const now       = Date.now();
    const neglected = goals
      .map(g => ({ g, days: (now - new Date(g.last_mentioned_at).getTime()) / 86_400_000 }))
      .filter(({ days }) => days > 14)
      .sort((a, b) => b.days - a.days);

    if (!neglected.length) return [];

    return [{
      type:         'NEGLECTED_GOAL',
      title:        'Goals needing attention',
      description:  `${neglected.map(({ g }) => g.name).join(', ')} haven't been referenced in ${Math.round(neglected[0].days)} days.`,
      entity_ids:   neglected.map(({ g }) => g.id),
      score:        Math.min(0.95, 0.6 + neglected[0].days / 100),
      generated_at: new Date().toISOString(),
    }];
  }

  // ---- 3. getGrowingProjects ---------------------------------
  // PROJECT nodes with mention_count growing — detected by above-avg mention density
  // relative to their age (mentions per day).

  async getGrowingProjects(userId: string): Promise<GraphInsight[]> {
    const projects = await this.repo.getNodesByType(userId, 'PROJECT', 50);
    if (!projects.length) return [];

    const scored = projects.map(p => {
      const ageDays = Math.max(1, (Date.now() - new Date(p.created_at).getTime()) / 86_400_000);
      const mentionsPerDay = p.mention_count / ageDays;
      return { p, mentionsPerDay };
    });

    const avgRate = scored.reduce((s, { mentionsPerDay }) => s + mentionsPerDay, 0) / scored.length;
    const growing = scored.filter(({ mentionsPerDay }) => mentionsPerDay > avgRate * 1.5)
      .sort((a, b) => b.mentionsPerDay - a.mentionsPerDay);

    if (!growing.length) return [];

    return [{
      type:         'GROWING_PROJECT',
      title:        'Growing projects',
      description:  `${growing.slice(0, 3).map(({ p }) => p.name).join(', ')} have above-average recent mention activity.`,
      entity_ids:   growing.map(({ p }) => p.id),
      score:        0.8,
      generated_at: new Date().toISOString(),
    }];
  }

  // ---- 4. getDisconnectedProjects ----------------------------
  // PROJECT nodes with zero active edges.

  async getDisconnectedProjects(userId: string): Promise<GraphInsight[]> {
    const projects = await this.repo.getNodesByType(userId, 'PROJECT', 50);
    if (!projects.length) return [];

    // C-1: single batch query instead of 1 query per project
    const edgeCounts = this.repo.getEdgeCountsByNodeIds
      ? await this.repo.getEdgeCountsByNodeIds(userId, projects.map(p => p.id))
      : new Map(await Promise.all(projects.map(async p => [p.id, (await this.repo.getEdgesByNode(userId, p.id)).length] as [string, number])));
    const disconnected = projects.filter(p => !edgeCounts.get(p.id));

    if (!disconnected.length) return [];

    return [{
      type:         'DISCONNECTED_PROJECT',
      title:        'Disconnected projects',
      description:  `${disconnected.map(p => p.name).join(', ')} have no graph relationships yet.`,
      entity_ids:   disconnected.map(p => p.id),
      score:        0.7,
      generated_at: new Date().toISOString(),
    }];
  }

  // ---- 5. getImportantPeople --------------------------------
  // PERSON nodes ranked by calculateGraphScore.
  // Returns top 5 people by composite score.

  async getImportantPeople(userId: string): Promise<GraphInsight[]> {
    const people = await this.repo.getNodesByType(userId, 'PERSON', 50);
    if (!people.length) return [];

    // C-2: single batch query instead of 50 parallel queries
    const edgeMap = await this.repo.getEdgesByNodeIds(userId, people.map(p => p.id));
    const scored = people.map((person) => {
      const edges     = edgeMap.get(person.id) ?? [];
      const active    = edges.filter(e => !e.is_archived);
      const avgStr    = active.reduce((s, e) => s + e.strength, 0) / Math.max(active.length, 1);
      const daysSince = (Date.now() - new Date(person.last_mentioned_at).getTime()) / 86_400_000;
      const score     = calculateGraphScore({
        importanceScore:     person.importance_score,
        edgeStrength:        avgStr,
        degree:              active.length,
        daysSinceLastUpdate: daysSince,
      });
      return { person, score };
    });

    const top = scored.sort((a, b) => b.score - a.score).slice(0, 5);
    if (!top.length) return [];

    return [{
      type:         'MOST_CONNECTED',
      title:        'Most important people',
      description:  `${top.map(t => t.person.name).join(', ')} are your highest-scoring people by connections and activity.`,
      entity_ids:   top.map(t => t.person.id),
      score:        top[0].score,
      generated_at: new Date().toISOString(),
    }];
  }

  // ---- 6. getRelationshipChanges ----------------------------
  // Edges whose strength changed significantly vs. snapshot.
  // Detects both strengthened and weakened relationships.

  async getRelationshipChanges(userId: string): Promise<GraphInsight[]> {
    const snapshot = await this.repo.getLatestSnapshot(userId);
    if (!snapshot) return [];

    const prevEdgeMap = new Map<string, number>(
      (snapshot.snapshot.edges as Array<{ id: string; strength: number }>)
        .map(e => [e.id, e.strength]),
    );

    // H-1: single batch query for all edges instead of 100 sequential queries
    const allNodes   = await this.repo.getMostImportantNodes(userId, 100);
    const edgeMap    = await this.repo.getEdgesByNodeIds(userId, allNodes.map(n => n.id));
    const seenEdgeIds = new Set<string>();
    const strengthened: string[] = [];
    const weakened: string[]     = [];

    for (const edges of edgeMap.values()) {
      for (const edge of edges) {
        if (seenEdgeIds.has(edge.id) || edge.is_archived) continue;
        seenEdgeIds.add(edge.id);

        const prev = prevEdgeMap.get(edge.id);
        if (prev === undefined) continue;
        const delta = edge.strength - prev;
        if (delta >= 0.15)  strengthened.push(edge.id);
        if (delta <= -0.15) weakened.push(edge.id);
      }
    }

    const insights: GraphInsight[] = [];
    if (strengthened.length) {
      insights.push({
        type:         'RISING_IMPORTANCE',
        title:        'Strengthened relationships',
        description:  `${strengthened.length} relationship(s) have grown significantly stronger since last snapshot.`,
        entity_ids:   strengthened,
        score:        0.85,
        generated_at: new Date().toISOString(),
      });
    }
    if (weakened.length) {
      insights.push({
        type:         'INACTIVE_PERSON',
        title:        'Weakened relationships',
        description:  `${weakened.length} relationship(s) have declined in strength.`,
        entity_ids:   weakened,
        score:        0.65,
        generated_at: new Date().toISOString(),
      });
    }

    return insights;
  }

  // ---- 7. getMostConnectedConcepts --------------------------
  // CONCEPT nodes ranked by degree (edge count) — cross-domain connectors.

  async getMostConnectedConcepts(userId: string): Promise<GraphInsight[]> {
    const concepts = await this.repo.getNodesByType(userId, 'CONCEPT', 50);
    if (!concepts.length) return [];

    // C-2: single batch query instead of 50 parallel queries
    const edgeMap = await this.repo.getEdgesByNodeIds(userId, concepts.map(c => c.id));
    const scored = concepts.map((c) => {
      const degree = (edgeMap.get(c.id) ?? []).filter(e => !e.is_archived).length;
      return { c, degree };
    });

    const top = scored.sort((a, b) => b.degree - a.degree).slice(0, 5).filter(t => t.degree > 0);
    if (!top.length) return [];

    return [{
      type:         'MOST_CONNECTED',
      title:        'Most connected concepts',
      description:  `${top.map(t => t.c.name).join(', ')} are your most interconnected concepts.`,
      entity_ids:   top.map(t => t.c.id),
      score:        Math.min(1, 0.5 + top[0].degree * 0.05),
      generated_at: new Date().toISOString(),
    }];
  }
}
