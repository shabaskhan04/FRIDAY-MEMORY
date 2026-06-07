// ============================================================
// graph.search.ts — Semantic + exact search + pure graph retrieval
// ============================================================

import type { GraphRepository }   from './graph.repository';
import type { GraphTraversal }    from './graph.traversal';
import type {
  GraphNode, GraphEdge, GraphSearchResult, SearchGraphQuery, NodeType,
} from './graph.types';
import type { QueryAnalysis }     from './graph.query-resolver';
import { SearchGraphSchema }      from './graph.schemas';
import { calculateGraphScore }    from './graph.scoring';

export class GraphSearch {
  constructor(
    private readonly repo:      GraphRepository,
    private readonly traversal: GraphTraversal,
    private readonly embedFn:   (text: string) => Promise<number[]>,
  ) {}

  // ---- Semantic + fuzzy search (existing, unchanged) --------

  async search(query: SearchGraphQuery): Promise<GraphSearchResult[]> {
    const parsed  = SearchGraphSchema.parse(query);
    console.log("[GRAPH SEARCH QUERY]", parsed.query);
    const results = new Map<string, GraphSearchResult>();

    const [exactResults, aliasResults, semanticResults, fuzzyResults] = await Promise.all([
      this.exactSearch(parsed),
      this.aliasSearch(parsed),
      this.semanticSearch(parsed),
      this.fuzzySearch(parsed),
    ]);

    console.log("[EXACT RESULTS]", exactResults.length);
    console.log("[ALIAS RESULTS]", aliasResults.length);
    console.log("[SEMANTIC RESULTS]", semanticResults.length);
    console.log("[FUZZY RESULTS]", fuzzyResults.length);
    console.log(`[graph.search] exact=${exactResults.length} alias=${aliasResults.length} semantic=${semanticResults.length} fuzzy=${fuzzyResults.length}`);

    for (const list of [exactResults, aliasResults, semanticResults, fuzzyResults]) {
      for (const r of list) {
        const existing = results.get(r.node.id);
        if (!existing || r.score > existing.score) results.set(r.node.id, r);
      }
    }

    // Fallback: query is a sentence — search each capitalised token individually
    if (results.size === 0) {
      const tokens = parsed.query
        .split(/\s+/)
        .map(t => t.replace(/[^a-zA-Z0-9]/g, ''))
        .filter(t => t.length >= 2 && /[A-Z]/.test(t[0]));

      const tokenResults = await Promise.all(
        tokens.flatMap(token => [
          this.repo.findNodesByName(parsed.user_id, token),
          this.repo.fuzzyFindNodes(parsed.user_id, token, 0.3),
        ])
      );

      for (const list of tokenResults) {
        for (const node of list) {
          if (!results.has(node.id)) results.set(node.id, { node, score: 0.7, match_reason: 'fuzzy' });
        }
      }
      console.log(`[graph.search] token fallback fired, tokens=${JSON.stringify(tokens)}, found=${results.size}`);
    }

    const finalResults = Array.from(results.values())
      .filter(r => {
        if (parsed.node_types?.length && !parsed.node_types.includes(r.node.node_type as NodeType)) return false;
        if (r.node.importance_score < parsed.min_importance) return false;
        return true;
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, parsed.limit);

    console.log(`[graph.search] finalResults=${finalResults.length}`);
    return finalResults;
  }

  async findByName(userId: string, name: string): Promise<GraphNode | null> {
    return (await this.repo.findNodesByName(userId, name))[0] ?? null;
  }

  async getProjectGraph(userId: string, projectName: string) {
    const results  = await this.search({ query: projectName, user_id: userId, node_types: ['PROJECT'], limit: 1 });
    const project  = results[0]?.node ?? null;
    if (!project) return { project: null, related: [], edges: [] };
    const edges    = await this.repo.getEdgesByNode(userId, project.id, 'both');
    const nodeIds  = [...new Set(edges.flatMap(e => [e.source_node_id, e.target_node_id]))].filter(id => id !== project.id);
    const related  = (await Promise.all(nodeIds.slice(0, 50).map(id => this.repo.getNodeById(id, userId))))
      .filter((n): n is GraphNode => n !== null);
    return { project, related, edges };
  }

  // ---- T4: Pure graph retrieval (no embeddings) -------------

  /**
   * graphRetrieve() — uses queryAnalysis to drive pure graph operations.
   *
   * PERSON_SEARCH:       locate person node → expand neighborhood → rank by graphScore
   * PROJECT_SEARCH:      locate project node → traverse depth 2 → rank by graphScore
   * GOAL_SEARCH:         locate GOAL nodes matching entities → expand, rank
   * RELATIONSHIP_SEARCH: find common neighbors + direct edges between entity pair
   * ENTITY_SEARCH:       exact + fuzzy name match only, rank by importance
   */
  async graphRetrieve(
    userId: string,
    query: string,
    queryAnalysis: QueryAnalysis,
  ): Promise<GraphSearchResult[]> {
    const { queryType, entities } = queryAnalysis;

    switch (queryType) {
      case 'PERSON_SEARCH':
        return this.personRetrieve(userId, entities);

      case 'PROJECT_SEARCH':
        return this.projectRetrieve(userId, entities);

      case 'GOAL_SEARCH':
        return this.goalRetrieve(userId, entities);

      case 'RELATIONSHIP_SEARCH':
        if (queryAnalysis.relationshipType) {
          return this.relationshipTypeRetrieve(userId, entities, queryAnalysis.relationshipType);
        }
        return this.relationshipRetrieve(userId, entities);

      case 'ENTITY_SEARCH':
      default:
        return this.entityRetrieve(userId, entities.length ? entities : [query]);
    }
  }

  // ---- Strategy implementations ----------------------------

  private async personRetrieve(userId: string, entities: string[]): Promise<GraphSearchResult[]> {
    const results: GraphSearchResult[] = [];

    for (const name of entities) {
      const person = await this.locateNode(userId, name, 'PERSON');
      if (!person) continue;

      const { neighbors, edges } = await this.traversal.bfs(userId, person.id, 2);
      const edgeMap = this.buildEdgeMap(edges);

      // Score: person node first, then ranked neighbors
      results.push({ node: person, score: 1.0, match_reason: 'exact' });

      for (const { node, depth } of neighbors) {
        const nodeEdges = edgeMap.get(node.id) ?? [];
        const avgStrength = nodeEdges.reduce((s, e) => s + e.strength, 0) / Math.max(nodeEdges.length, 1);
        const daysSince = (Date.now() - new Date(node.last_mentioned_at).getTime()) / 86_400_000;
        const score = calculateGraphScore({
          importanceScore:     node.importance_score,
          edgeStrength:        avgStrength,
          degree:              nodeEdges.length,
          daysSinceLastUpdate: daysSince,
        }) * (1 / (depth + 1)); // depth penalty
        results.push({ node, score, match_reason: 'exact' });
      }
    }

    return this.dedupeAndSort(results);
  }

  private async projectRetrieve(userId: string, entities: string[]): Promise<GraphSearchResult[]> {
    const results: GraphSearchResult[] = [];

    for (const name of entities) {
      const project = await this.locateNode(userId, name, 'PROJECT')
        ?? await this.locateNode(userId, name);
      if (!project) continue;

      const { neighbors, edges } = await this.traversal.bfs(userId, project.id, 2);
      const edgeMap = this.buildEdgeMap(edges);

      results.push({ node: project, score: 1.0, match_reason: 'exact' });

      for (const { node, depth } of neighbors) {
        const nodeEdges = edgeMap.get(node.id) ?? [];
        const avgStr = nodeEdges.reduce((s, e) => s + e.strength, 0) / Math.max(nodeEdges.length, 1);
        const daysSince = (Date.now() - new Date(node.last_mentioned_at).getTime()) / 86_400_000;
        const score = calculateGraphScore({
          importanceScore:     node.importance_score,
          edgeStrength:        avgStr,
          degree:              nodeEdges.length,
          daysSinceLastUpdate: daysSince,
        }) / (depth + 1);
        results.push({ node, score, match_reason: 'exact' });
      }
    }

    return this.dedupeAndSort(results);
  }

  private async goalRetrieve(userId: string, entities: string[]): Promise<GraphSearchResult[]> {
    // Find all GOAL nodes, then find those related to the named entities
    const allGoals  = await this.repo.getNodesByType(userId, 'GOAL', 50);
    const results:  GraphSearchResult[] = [];

    const targetNames = entities.map(e => e.toLowerCase());

    for (const goal of allGoals) {
      // Include if goal name matches entity keywords or if no entities specified
      const matches = !targetNames.length ||
        targetNames.some(t => goal.name.toLowerCase().includes(t) || goal.aliases.some(a => a.toLowerCase().includes(t)));

      if (!matches) continue;

      const edges = await this.repo.getEdgesByNode(userId, goal.id, 'both');
      const avgStr = edges.reduce((s, e) => s + e.strength, 0) / Math.max(edges.length, 1);
      const daysSince = (Date.now() - new Date(goal.last_mentioned_at).getTime()) / 86_400_000;
      results.push({
        node:  goal,
        score: calculateGraphScore({
          importanceScore:     goal.importance_score,
          edgeStrength:        avgStr,
          degree:              edges.length,
          daysSinceLastUpdate: daysSince,
        }),
        match_reason: 'exact',
      });

      // Include connected projects/concepts
      for (const edge of edges) {
        const otherId = edge.source_node_id === goal.id ? edge.target_node_id : edge.source_node_id;
        const other   = await this.repo.getNodeById(otherId, userId);
        if (other && ['PROJECT', 'CONCEPT', 'TASK'].includes(other.node_type)) {
          results.push({ node: other, score: edge.strength * 0.8, match_reason: 'exact' });
        }
      }
    }

    return this.dedupeAndSort(results);
  }

  private async relationshipRetrieve(userId: string, entities: string[]): Promise<GraphSearchResult[]> {
    if (entities.length < 2) return this.entityRetrieve(userId, entities);

    const [nodeA, nodeB] = await Promise.all([
      this.locateNode(userId, entities[0]),
      this.locateNode(userId, entities[1]),
    ]);

    if (!nodeA || !nodeB) return [];

    const results: GraphSearchResult[] = [
      { node: nodeA, score: 1.0, match_reason: 'exact' },
      { node: nodeB, score: 1.0, match_reason: 'exact' },
    ];

    // Find direct edge
    const directEdge = await this.repo.getEdgeBetween(userId, nodeA.id, nodeB.id);
    if (directEdge) {
      // Nodes are directly connected — also show their neighborhoods
      const [nA, nB] = await Promise.all([
        this.repo.getEdgesByNode(userId, nodeA.id, 'both'),
        this.repo.getEdgesByNode(userId, nodeB.id, 'both'),
      ]);
      const commonIds = new Set(nA.map(e => e.source_node_id === nodeA.id ? e.target_node_id : e.source_node_id));
      const bIds      = new Set(nB.map(e => e.source_node_id === nodeB.id ? e.target_node_id : e.source_node_id));

      // Common neighbors
      for (const id of commonIds) {
        if (bIds.has(id)) {
          const node = await this.repo.getNodeById(id, userId);
          if (node) results.push({ node, score: 0.85, match_reason: 'exact' });
        }
      }
    } else {
      // Find path up to depth 4 and include path nodes
      const path = await this.traversal.shortestPath(userId, nodeA.id, nodeB.id);
      if (path) {
        for (let i = 1; i < path.length - 1; i++) {
          const node = await this.repo.getNodeById(path[i], userId);
          if (node) results.push({ node, score: 0.9 - i * 0.1, match_reason: 'exact' });
        }
      }
    }

    return this.dedupeAndSort(results);
  }

  /**
   * relationshipTypeRetrieve() — finds all nodes connected to a target entity
   * via a specific relationship type, ranked by edge strength.
   * e.g. OWNS + FRIDAY → [I, Khan Designs]
   */
  async relationshipTypeRetrieve(
    userId: string,
    entities: string[],
    relationshipType: string,
  ): Promise<GraphSearchResult[]> {
    console.log("[REL QUERY TYPE]", "RELATIONSHIP_SEARCH");
    console.log("[REL TYPE]", relationshipType);

    const results: GraphSearchResult[] = [];

    if (entities.length === 0) {
      // No target entity — scan all nodes for edges of this relationship type
      const importantNodes = await this.repo.getMostImportantNodes(userId, 100);
      const edgeMap = await this.repo.getEdgesByNodeIds(userId, importantNodes.map(n => n.id));
      const seen = new Set<string>();
      for (const [, edges] of edgeMap) {
        for (const edge of edges) {
          if (edge.relationship_type !== relationshipType) continue;
          for (const id of [edge.source_node_id, edge.target_node_id]) {
            if (seen.has(id)) continue;
            seen.add(id);
            const node = importantNodes.find(n => n.id === id)
              ?? await this.repo.getNodeById(id, userId);
            if (node) results.push({ node, score: edge.strength, match_reason: 'exact' });
          }
        }
      }
    } else {
      for (const name of entities) {
        const target = await this.locateNode(userId, name);
        if (!target) continue;

        const allEdges = await this.repo.getEdgesByNode(userId, target.id, 'both');
        const matched  = allEdges.filter(e => e.relationship_type === relationshipType);

        results.push({ node: target, score: 1.0, match_reason: 'exact' });

        for (const edge of matched) {
          const otherId = edge.source_node_id === target.id ? edge.target_node_id : edge.source_node_id;
          const other   = await this.repo.getNodeById(otherId, userId);
          if (other) results.push({ node: other, score: edge.strength, match_reason: 'exact' });
        }
      }
    }

    const deduped = this.dedupeAndSort(results);
    console.log("[REL RESULTS]", deduped.map(r => ({ name: r.node.name, type: r.node.node_type, score: r.score })));
    return deduped;
  }

  private async entityRetrieve(userId: string, entities: string[]): Promise<GraphSearchResult[]> {
    const results: GraphSearchResult[] = [];
    for (const name of entities) {
      const exact = await this.repo.findNodesByName(userId, name);
      for (const node of exact) {
        results.push({ node, score: 1.0, match_reason: 'exact' });
      }
      if (!exact.length) {
        const fuzzy = await this.repo.fuzzyFindNodes(userId, name, 0.3);
        for (const node of fuzzy) {
          results.push({ node, score: 0.6, match_reason: 'fuzzy' });
        }
      }
    }
    return this.dedupeAndSort(results);
  }

  // ---- T6: getMostImportantNodes (with type filter + ranking) --

  async getMostImportantNodes(
    userId: string,
    options: { nodeType?: NodeType; limit?: number } = {},
  ): Promise<GraphSearchResult[]> {
    const limit = options.limit ?? 20;
    const nodes = options.nodeType
      ? await this.repo.getNodesByType(userId, options.nodeType, limit * 2)
      : await this.repo.getMostImportantNodes(userId, limit * 2);

    // Batch-fetch all edges in one query instead of N parallel queries
    const edgeMap = this.repo.getEdgesByNodeIds
      ? await this.repo.getEdgesByNodeIds(userId, nodes.map(n => n.id))
      : new Map(await Promise.all(nodes.map(async n => [n.id, await this.repo.getEdgesByNode(userId, n.id)] as [string, GraphEdge[]])));

    const scored = nodes.map((node) => {
      const activeEdges = (edgeMap.get(node.id) ?? []).filter(e => !e.is_archived);
      const avgStr      = activeEdges.reduce((s, e) => s + e.strength, 0) / Math.max(activeEdges.length, 1);
      const daysSince   = (Date.now() - new Date(node.last_mentioned_at).getTime()) / 86_400_000;
      return {
        node,
        score: calculateGraphScore({
          importanceScore:     node.importance_score,
          edgeStrength:        avgStr,
          degree:              activeEdges.length,
          daysSinceLastUpdate: daysSince,
        }),
        match_reason: 'exact' as const,
      };
    });

    return scored.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  // ---- Private helpers --------------------------------------

  private async locateNode(userId: string, name: string, nodeType?: NodeType): Promise<GraphNode | null> {
    const exact = await this.repo.findNodesByName(userId, name);
    const filtered = nodeType ? exact.filter(n => n.node_type === nodeType) : exact;
    if (filtered.length) return filtered[0];

    // Try alias
    const byAlias = await this.repo.findNodesByAlias(userId, name.toLowerCase());
    const filteredAlias = nodeType ? byAlias.filter(n => n.node_type === nodeType) : byAlias;
    if (filteredAlias.length) return filteredAlias[0];

    // Fuzzy fallback
    const fuzzy = await this.repo.fuzzyFindNodes(userId, name, 0.4);
    const filteredFuzzy = nodeType ? fuzzy.filter(n => n.node_type === nodeType) : fuzzy;
    return filteredFuzzy[0] ?? null;
  }

  private buildEdgeMap(edges: GraphEdge[]): Map<string, GraphEdge[]> {
    const map = new Map<string, GraphEdge[]>();
    for (const edge of edges) {
      for (const id of [edge.source_node_id, edge.target_node_id]) {
        if (!map.has(id)) map.set(id, []);
        map.get(id)!.push(edge);
      }
    }
    return map;
  }

  private dedupeAndSort(results: GraphSearchResult[]): GraphSearchResult[] {
    const seen = new Map<string, GraphSearchResult>();
    for (const r of results) {
      const existing = seen.get(r.node.id);
      if (!existing || r.score > existing.score) seen.set(r.node.id, r);
    }
    return Array.from(seen.values()).sort((a, b) => b.score - a.score);
  }

  // ---- Original private search strategies ------------------

  private async exactSearch(q: { query: string; user_id: string }): Promise<GraphSearchResult[]> {
    return (await this.repo.findNodesByName(q.user_id, q.query))
      .map(node => ({ node, score: 1.0, match_reason: 'exact' as const }));
  }

  private async aliasSearch(q: { query: string; user_id: string }): Promise<GraphSearchResult[]> {
    return (await this.repo.findNodesByAlias(q.user_id, q.query.toLowerCase()))
      .map(node => ({ node, score: 0.9, match_reason: 'alias' as const }));
  }

  private async semanticSearch(q: { query: string; user_id: string }): Promise<GraphSearchResult[]> {
    try {
      const embedding = await this.embedFn(q.query);
      return (await this.repo.semanticSearchNodes(q.user_id, embedding, 10, 0.7))
        .map(r => ({ node: r, score: (r as any).similarity ?? 0.7, match_reason: 'semantic' as const }));
    } catch {
      return [];
    }
  }

  private async fuzzySearch(q: { query: string; user_id: string }): Promise<GraphSearchResult[]> {
    return (await this.repo.fuzzyFindNodes(q.user_id, q.query, 0.3))
      .map(node => ({ node, score: 0.6, match_reason: 'fuzzy' as const }));
  }
}
