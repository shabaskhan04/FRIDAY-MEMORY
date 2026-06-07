// ============================================================
// graph-planner.ts — Agentic graph reasoner
//
// Analyzes query intent, selects graph operations, executes
// traversal, and returns a structured subgraph + LLM context.
// No semantic retrieval when graph traversal can answer directly.
// ============================================================

import type { GraphRepository } from './graph.repository';
import type { GraphSearch }     from './graph.search';
import type { GraphTraversal }  from './graph.traversal';
import type { GraphNode, GraphEdge } from './graph.types';
import { resolveQuery }         from './graph.query-resolver';

export type PlanOperation =
  | 'FIND_OWNERS'           // X --OWNS--> target
  | 'FIND_WORKERS'          // X --WORKS_ON--> target
  | 'FIND_COLLABORATORS'    // X --WORKS_WITH--> target
  | 'FIND_PATH'             // shortest path between two entities
  | 'EXPAND_NEIGHBORHOOD'   // all nodes connected to X
  | 'FILTER_BY_REL'         // edges of specific rel type touching X
  | 'ENTITY_LOOKUP';        // basic name lookup

export interface GraphPlan {
  operation:    PlanOperation;
  entities:     string[];
  rel_type?:    string;
  max_depth?:   number;
}

export interface PlanResult {
  plan:         GraphPlan;
  nodes:        GraphNode[];
  edges:        GraphEdge[];
  context:      string;   // compressed text ready for LLM injection
  used_graph:   boolean;  // false = fell back to empty, LLM should use semantic retrieval
}

// ---- Intent → operation mapping ---------------------------

const OP_KEYWORDS: Array<{ pattern: RegExp; operation: PlanOperation; rel_type?: string }> = [
  { pattern: /who\s+(owns?|is\s+the\s+owner)/i,      operation: 'FIND_OWNERS',        rel_type: 'OWNS' },
  { pattern: /who\s+(works?\s+on|is\s+building)/i,   operation: 'FIND_WORKERS',       rel_type: 'WORKS_ON' },
  { pattern: /who\s+(works?\s+with|collaborates)/i,  operation: 'FIND_COLLABORATORS', rel_type: 'WORKS_WITH' },
  { pattern: /how\s+is\s+.+\s+connected\s+to/i,      operation: 'FIND_PATH' },
  { pattern: /path\s+(between|from)/i,               operation: 'FIND_PATH' },
  { pattern: /who\s+helps?\s+(build|create|make)/i,  operation: 'FIND_WORKERS',       rel_type: 'WORKS_ON' },
];

function buildPlan(query: string): GraphPlan {
  const analysis = resolveQuery(query);

  for (const { pattern, operation, rel_type } of OP_KEYWORDS) {
    if (pattern.test(query)) {
      return { operation, entities: analysis.entities, rel_type, max_depth: 3 };
    }
  }

  if (analysis.queryType === 'RELATIONSHIP_SEARCH' && analysis.relationshipType) {
    return { operation: 'FILTER_BY_REL', entities: analysis.entities, rel_type: analysis.relationshipType };
  }

  if (analysis.queryType === 'PATH_SEARCH') {
    return { operation: 'FIND_PATH', entities: analysis.entities, max_depth: 6 };
  }

  return { operation: 'EXPAND_NEIGHBORHOOD', entities: analysis.entities, max_depth: 2 };
}

// ---- Executor ---------------------------------------------

export class GraphPlanner {
  constructor(
    private readonly repo:      GraphRepository,
    private readonly search:    GraphSearch,
    private readonly traversal: GraphTraversal,
  ) {}

  async plan(userId: string, query: string): Promise<PlanResult> {
    const graphPlan = buildPlan(query);
    console.log('[graph-planner] plan', graphPlan);

    switch (graphPlan.operation) {
      case 'FIND_OWNERS':
      case 'FIND_WORKERS':
      case 'FIND_COLLABORATORS':
      case 'FILTER_BY_REL':
        return this.executeRelFilter(userId, graphPlan);

      case 'FIND_PATH':
        return this.executeFindPath(userId, graphPlan);

      case 'EXPAND_NEIGHBORHOOD':
      default:
        return this.executeNeighborhood(userId, graphPlan);
    }
  }

  // ---- Strategy implementations ---------------------------

  private async executeRelFilter(userId: string, plan: GraphPlan): Promise<PlanResult> {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    for (const name of plan.entities) {
      const target = await this.search.findByName(userId, name);
      if (!target) continue;
      const allEdges = await this.repo.getEdgesByNode(userId, target.id, 'both');
      const matched  = plan.rel_type ? allEdges.filter(e => e.relationship_type === plan.rel_type) : allEdges;

      nodes.push(target);
      edges.push(...matched);

      // Hydrate connected nodes
      for (const edge of matched) {
        const otherId = edge.source_node_id === target.id ? edge.target_node_id : edge.source_node_id;
        const other   = await this.repo.getNodeById(otherId, userId);
        if (other && !nodes.find(n => n.id === other.id)) nodes.push(other);
      }
    }

    return this.buildResult(plan, nodes, edges);
  }

  private async executeFindPath(userId: string, plan: GraphPlan): Promise<PlanResult> {
    if (plan.entities.length < 2) return this.executeNeighborhood(userId, plan);

    const [nodeA, nodeB] = await Promise.all([
      this.search.findByName(userId, plan.entities[0]),
      this.search.findByName(userId, plan.entities[1]),
    ]);
    if (!nodeA || !nodeB) return this.buildResult(plan, [], []);

    const raw = await this.traversal.findRelationshipPath(userId, nodeA.id, nodeB.id, plan.max_depth ?? 6);
    if (!raw) return this.buildResult(plan, [nodeA, nodeB], []);

    const pathNodes = (await Promise.all(raw.path.map(id => this.repo.getNodeById(id, userId))))
      .filter((n): n is GraphNode => n !== null);

    // Fetch edges between consecutive path nodes
    const pathEdges: GraphEdge[] = [];
    for (let i = 0; i < raw.path.length - 1; i++) {
      const fwd = await this.repo.getEdgeBetween(userId, raw.path[i], raw.path[i + 1]);
      const bwd = fwd ?? await this.repo.getEdgeBetween(userId, raw.path[i + 1], raw.path[i]);
      if (bwd) pathEdges.push(bwd);
    }

    return this.buildResult(plan, pathNodes, pathEdges);
  }

  private async executeNeighborhood(userId: string, plan: GraphPlan): Promise<PlanResult> {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    for (const name of plan.entities) {
      const root = await this.search.findByName(userId, name);
      if (!root) continue;
      const result = await this.traversal.bfs(userId, root.id, plan.max_depth ?? 2);
      nodes.push(result.root, ...result.neighbors.map(n => n.node));
      edges.push(...result.edges);
    }

    return this.buildResult(plan, nodes, edges);
  }

  // ---- Result builder -------------------------------------

  private buildResult(plan: GraphPlan, nodes: GraphNode[], edges: GraphEdge[]): PlanResult {
    // Dedupe nodes
    const seen = new Set<string>();
    const deduped = nodes.filter(n => seen.has(n.id) ? false : (seen.add(n.id), true));

    const nodeLookup = new Map(deduped.map(n => [n.id, n]));

    const nodeLines = deduped.slice(0, 15).map(n =>
      `[${n.node_type}] ${n.name} (imp:${n.importance_score.toFixed(2)})`
    ).join('\n');

    const edgeLines = edges.slice(0, 20).map(e => {
      const src = nodeLookup.get(e.source_node_id)?.name ?? e.source_node_id;
      const tgt = nodeLookup.get(e.target_node_id)?.name ?? e.target_node_id;
      return `${src} --[${e.relationship_type}]--> ${tgt}`;
    }).join('\n');

    const context = [
      nodeLines  ? `## Graph entities:\n${nodeLines}` : '',
      edgeLines  ? `## Relationships:\n${edgeLines}`  : '',
    ].filter(Boolean).join('\n\n');

    console.log('[graph-planner] result nodes=%d edges=%d', deduped.length, edges.length);

    return {
      plan,
      nodes:      deduped,
      edges,
      context,
      used_graph: deduped.length > 0,
    };
  }
}
