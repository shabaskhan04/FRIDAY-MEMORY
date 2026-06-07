// ============================================================
// graph.service.ts — Core orchestration service
// The single entry point for all graph operations
// ============================================================

import type { GraphRepository }   from './graph.repository';
import type { GraphExtractor }    from './graph.extractor';
import type { GraphMerger }       from './graph.merger';
import type { GraphSearch }       from './graph.search';
import type { GraphTraversal }    from './graph.traversal';
import type { GraphInsights }     from './graph.insights';
import type {
  GraphNode, GraphEdge, CreateNodeInput, CreateEdgeInput,
  TraversalResult, GraphInsight, GraphSnapshot, GraphEvent,
  ExtractionResult, MergeDecision, GraphSearchResult,
  SearchGraphQuery, NodeType, PathResult, EntityProfile,
} from './graph.types';
import { scoreNode, decayEdgeStrength, boostEdgeStrength } from './graph.scoring';
import { resolveQuery }            from './graph.query-resolver';
import { GraphPathfinder }         from './pathfinder';
import { EntityProfiler }          from './entity-profile';
import { GraphAnalyticsEngine }    from './graph-analytics';
import type { GraphAnalytics, NodeAnalytics } from './graph-analytics';
import { GraphEvidenceService }    from './graph-evidence';
import type { NodeEvidence, EdgeEvidence } from './graph-evidence';
import { GraphTemporalService }    from './graph-temporal';
import type { TemporalNodeInfo, GraphChanges } from './graph-temporal';
import { GraphPlanner }            from './graph-planner';
import type { PlanResult }         from './graph-planner';

// ---- Config -----------------------------------------------

const CONFIDENCE_REASSESS_THRESHOLD = 0.65;
const SCORE_REFRESH_BATCH           = 50;

// ============================================================

export class GraphService {
  private readonly pathfinder: GraphPathfinder;
  private readonly profiler:   EntityProfiler;
  private readonly analytics:  GraphAnalyticsEngine;
  private readonly evidence:   GraphEvidenceService;
  private readonly temporal:   GraphTemporalService;
  private readonly planner:    GraphPlanner;

  constructor(
    private readonly repo:       GraphRepository,
    private readonly extractor:  GraphExtractor,
    private readonly merger:     GraphMerger,
    private readonly search:     GraphSearch,
    private readonly traversal:  GraphTraversal,
    private readonly insights:   GraphInsights,
    private readonly embedFn:    (text: string) => Promise<number[]>,
  ) {
    this.pathfinder = new GraphPathfinder(repo, traversal, search);
    this.profiler   = new EntityProfiler(repo, search);
    this.analytics  = new GraphAnalyticsEngine(repo);
    this.evidence   = new GraphEvidenceService(repo.getDb(), repo, search);
    this.temporal   = new GraphTemporalService(repo.getDb());
    this.planner    = new GraphPlanner(repo, search, traversal);
  }

  // ---- Ingestion -------------------------------------------

  /**
   * Primary ingestion endpoint.
   * Rule #7: embedding generated ONCE for the full memory text.
   * That embedding drives both semantic dedup AND future retrieval.
   * No per-node embeddings.
   */
  async ingestMemory(
    userId: string,
    rawMemory: string,
    memoryId?: string,
  ): Promise<{ nodes: GraphNode[]; edges: GraphEdge[]; extraction: ExtractionResult }> {
    // 1. Embed the MEMORY TEXT once (Rule #7 — not per node)
    const memoryEmbedding = await this.embedFn(rawMemory);

    // 2. Extract entities via AI Gateway (L1 model)
    let extraction = await this.extractor.extractFromMemory(rawMemory);

    // 3. Reassess only if avg confidence is low (saves an LLM call most of the time)
    const avgConfidence = extraction.nodes.reduce((s, n) => s + n.confidence, 0)
      / Math.max(extraction.nodes.length, 1);
    if (avgConfidence < CONFIDENCE_REASSESS_THRESHOLD) {
      extraction = await this.extractor.assessConfidence(rawMemory, extraction);
    }

    // 4. Persist nodes — use memory embedding for dedup, NOT a new embed per node
    const nodeMap = new Map<string, GraphNode>();
    const persistedNodes: GraphNode[] = [];

    for (const extracted of extraction.nodes) {
      // Dedup: name-based only (exact + fuzzy + alias).
      // Do NOT pass memoryEmbedding here — all nodes share the same embedding, giving
      // cosine similarity = 1.0 across unrelated entities and collapsing them into one node.
      const candidates = await this.merger.findDuplicateCandidates(
        userId,
        { name: extracted.name, node_type: extracted.node_type },
      );

      const topCandidate = candidates[0];
      if (topCandidate && topCandidate.similarity >= 0.95) {
        const updated = await this.repo.updateNode(topCandidate.node.id, userId, {
          description:     extracted.description ?? topCandidate.node.description ?? undefined,
          aliases:         [...new Set([...topCandidate.node.aliases, ...(extracted.aliases ?? [])])],
          confidence_score: Math.max(topCandidate.node.confidence_score, extracted.confidence),
          // Do NOT re-embed on every mention — only set embedding when node is first created
        });
        await this.repo.incrementMentionCount(updated.id, userId);
        console.log("[NODE MERGED]", { extracted: extracted.name, into: topCandidate.node.name, id: updated.id, similarity: topCandidate.similarity });
        nodeMap.set(extracted.name, updated);
        persistedNodes.push(updated);
      } else {
        const input: CreateNodeInput = {
          user_id:          userId,
          node_type:        extracted.node_type,
          name:             extracted.name,
          description:      extracted.description ?? undefined,
          aliases:          extracted.aliases ?? [],
          confidence_score: extracted.confidence,
          embedding:        memoryEmbedding,   // shared memory embedding for new node
          source_memory_ids: memoryId ? [memoryId] : [],
          metadata:         extracted.metadata ?? {},
        };
        const node = await this.repo.createNode(input);
        console.log("[NODE CREATED]", { name: node.name, type: node.node_type, id: node.id });
        await this.repo.logEvent(userId, 'NODE_CREATED', node.id, 'node', { source_memory: memoryId });
        nodeMap.set(extracted.name, node);
        persistedNodes.push(node);
      }
    }

    // 5. Persist edges
    const persistedEdges: GraphEdge[] = [];
    for (const extracted of extraction.edges) {
      const sourceNode = nodeMap.get(extracted.source);
      const targetNode = nodeMap.get(extracted.target);
      if (!sourceNode || !targetNode) continue;

      // Guard: two different extracted names can resolve to the same persisted node after dedup
      if (sourceNode.id === targetNode.id) {
        console.warn(`[graph] skipped self-loop edge: "${extracted.source}" → "${extracted.target}" both resolved to node ${sourceNode.id}`);
        continue;
      }

      const existing = await this.repo.getEdgeBetween(
        userId, sourceNode.id, targetNode.id, extracted.relationship_type,
      );

      if (existing) {
        const newStrength = boostEdgeStrength(existing.strength);
        await this.repo.updateEdgeStrength(existing.id, userId, newStrength);
        await this.repo.incrementEdgeMention(existing.id, userId);
        persistedEdges.push({ ...existing, strength: newStrength });
      } else {
        const input: CreateEdgeInput = {
          user_id:           userId,
          source_node_id:    sourceNode.id,
          target_node_id:    targetNode.id,
          relationship_type: extracted.relationship_type,
          strength:          extracted.confidence,
          confidence:        extracted.confidence,
          source_memory_ids: memoryId ? [memoryId] : [],
          metadata:          extracted.metadata ?? {},
        };
        const edge = await this.repo.upsertEdge(input);
        await this.repo.logEvent(userId, 'EDGE_CREATED', edge.id, 'edge', { source_memory: memoryId });
        persistedEdges.push(edge);
      }
    }

    // 6. Refresh scores (deferred — do not block ingestion response)
    this.refreshNodeScores(userId, persistedNodes.map(n => n.id)).catch(() => {});

    return { nodes: persistedNodes, edges: persistedEdges, extraction };
  }

  // ---- Node CRUD -------------------------------------------

  async createNode(input: CreateNodeInput): Promise<GraphNode> {
    const node = await this.repo.createNode(input);
    await this.repo.logEvent(input.user_id, 'NODE_CREATED', node.id, 'node');
    return node;
  }

  async getNode(userId: string, nodeId: string): Promise<GraphNode | null> {
    return this.repo.getNodeById(nodeId, userId);
  }

  async findNodeByName(userId: string, name: string): Promise<GraphNode | null> {
    return this.search.findByName(userId, name);
  }

  // ---- Edge CRUD -------------------------------------------

  async createEdge(input: CreateEdgeInput): Promise<GraphEdge> {
    const edge = await this.repo.upsertEdge(input);
    await this.repo.logEvent(input.user_id, 'EDGE_CREATED', edge.id, 'edge');
    return edge;
  }

  // ---- Traversal -------------------------------------------

  async getConnectedNodes(userId: string, nodeId: string): Promise<GraphEdge[]> {
    return this.repo.getEdgesByNode(userId, nodeId, 'both');
  }

  async getNodeNeighborhood(userId: string, nodeId: string, depth = 2): Promise<TraversalResult> {
    return this.traversal.bfs(userId, nodeId, depth);
  }

  async getShortestPath(userId: string, fromId: string, toId: string): Promise<string[] | null> {
    return this.traversal.shortestPath(userId, fromId, toId);
  }

  /** Find a named path between two entities, returning a fully hydrated PathResult. */
  async findPath(
    userId:     string,
    sourceName: string,
    targetName: string,
    maxDepth  = 6,
  ): Promise<PathResult> {
    return this.pathfinder.findShortestPath(userId, sourceName, targetName, maxDepth);
  }

  /** Find a path between two node IDs, returning a fully hydrated PathResult. */
  async findPathById(
    userId:   string,
    sourceId: string,
    targetId: string,
    maxDepth  = 6,
  ): Promise<PathResult> {
    return this.pathfinder.findShortestPathById(userId, sourceId, targetId, maxDepth);
  }

  // ---- Entity profiles -------------------------------------

  async getEntityProfile(userId: string, name: string): Promise<EntityProfile | null> {
    return this.profiler.getEntityProfile(userId, name);
  }

  async getEntityProfileById(userId: string, nodeId: string): Promise<EntityProfile | null> {
    return this.profiler.getEntityProfileById(userId, nodeId);
  }

  // ---- Analytics -------------------------------------------

  async getGraphAnalytics(userId: string, topN = 10): Promise<GraphAnalytics> {
    return this.analytics.computeAnalytics(userId, topN);
  }

  async getNodeAnalytics(userId: string, nodeId: string): Promise<NodeAnalytics | null> {
    return this.analytics.getNodeAnalytics(userId, nodeId);
  }

  // ---- Evidence linking ------------------------------------

  async getNodeEvidence(userId: string, name: string): Promise<NodeEvidence | null> {
    return this.evidence.getNodeEvidence(userId, name);
  }

  async getNodeEvidenceById(userId: string, nodeId: string): Promise<NodeEvidence | null> {
    return this.evidence.getNodeEvidenceById(userId, nodeId);
  }

  async getEdgeEvidence(userId: string, edgeId: string): Promise<EdgeEvidence | null> {
    return this.evidence.getEdgeEvidence(userId, edgeId);
  }

  async getMemoryGraphContext(userId: string, memoryId: string): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
    return this.evidence.getMemoryGraphContext(userId, memoryId);
  }

  // ---- Temporal --------------------------------------------

  async getEntityFirstSeen(userId: string, name: string): Promise<TemporalNodeInfo | null> {
    return this.temporal.getNodeFirstSeen(userId, name);
  }

  async getGraphChangesSince(userId: string, since: Date): Promise<GraphChanges> {
    return this.temporal.getChangesSince(userId, since);
  }

  // ---- Agentic planner -------------------------------------

  async planQuery(userId: string, query: string): Promise<PlanResult> {
    return this.planner.plan(userId, query);
  }

  // ---- Search ----------------------------------------------

  async searchGraph(query: SearchGraphQuery): Promise<GraphSearchResult[]> {
    return this.search.search(query);
  }

  async getProjectGraph(userId: string, projectName: string) {
    return this.search.getProjectGraph(userId, projectName);
  }

  // ---- Analytics -------------------------------------------

  async getMostImportantNodes(userId: string, limit = 20): Promise<GraphNode[]> {
    return this.repo.getMostImportantNodes(userId, limit);
  }

  async getRecentGraphChanges(userId: string, limit = 50): Promise<GraphEvent[]> {
    return this.repo.getRecentEvents(userId, limit);
  }

  async generateInsights(userId: string): Promise<GraphInsight[]> {
    return this.insights.generateInsights(userId);
  }

  // ---- Merge -----------------------------------------------

  async mergeNodes(userId: string, decision: MergeDecision): Promise<GraphNode> {
    const merged = await this.merger.mergeNodes(userId, decision);
    await this.repo.logEvent(userId, 'NODE_MERGED', merged.id, 'node', {
      merge_ids: decision.merge_ids,
    });
    return merged;
  }

  // ---- Snapshots -------------------------------------------

  async takeSnapshot(userId: string, trigger = 'manual'): Promise<GraphSnapshot> {
    const snapshot = await this.repo.createSnapshot(userId, trigger);
    await this.repo.logEvent(userId, 'SNAPSHOT_TAKEN', snapshot.id, null, { trigger });
    return snapshot;
  }

  // ---- Maintenance -----------------------------------------

  /**
   * Decay stale edge strengths. Run as a cron job (e.g., daily).
   */
  async decayStaleEdges(userId: string): Promise<number> {
    const cutoff = new Date(Date.now() - 7 * 86_400_000); // 7 days
    const stale  = await this.repo.getStaleEdges(userId, cutoff);
    let updated  = 0;

    for (const edge of stale) {
      const newStrength = decayEdgeStrength(edge);
      if (Math.abs(newStrength - edge.strength) > 0.01) {
        await this.repo.updateEdgeStrength(edge.id, userId, newStrength);
        updated++;
      }
    }
    return updated;
  }

  /**
   * Recompute importance_score for a batch of nodes.
   */
  async refreshNodeScores(userId: string, nodeIds: string[]): Promise<void> {
    const batch = nodeIds.slice(0, SCORE_REFRESH_BATCH);
    await Promise.all(batch.map(async (id) => {
      const [node, edges] = await Promise.all([
        this.repo.getNodeById(id, userId),
        this.repo.getEdgesByNode(userId, id, 'both'),
      ]);
      if (!node) return;

      const { final_importance } = scoreNode({ node, edges });
      await this.repo.updateNodeScores(id, userId, { importance_score: final_importance });
      await this.repo.logEvent(userId, 'SCORE_UPDATED', id, 'node', { importance_score: final_importance });
    }));
  }

  /**
   * buildQueryContext() — Rule #5: graph-first, LLM-last.
   *
   * Runs BEFORE any LLM call. Collects from the graph:
   *   - relevant nodes (semantic + exact + fuzzy)
   *   - their edges
   *   - attention scores
   *   - active goals
   *   - causal links
   *   - contradiction signals
   *
   * The compressed result is passed to the LLM instead of the raw question.
   * Never sends the full graph.
   */
  async buildQueryContext(
    userId: string,
    query: string,
    embedding: number[],
    maxNodes = 10,
  ): Promise<{
    nodes:    GraphNode[];
    edges:    GraphEdge[];
    goals:    GraphNode[];
    summary:  string;       // compressed context string ready for LLM prompt injection
  }> {
    console.log("[BUILD CONTEXT USER]", userId);
    console.log("[BUILD CONTEXT QUERY]", query);

    // 1. Graph-first retrieval: classify query → extract entities → traverse graph
    const queryAnalysis = resolveQuery(query);
    console.log("[REL QUERY TYPE]", queryAnalysis.queryType);
    console.log("[REL TYPE]", queryAnalysis.relationshipType ?? "(none)");

    const searchResults = queryAnalysis.queryType === 'RELATIONSHIP_SEARCH' && queryAnalysis.relationshipType
      ? await this.search.relationshipTypeRetrieve(userId, queryAnalysis.entities, queryAnalysis.relationshipType)
      : await this.search.graphRetrieve(userId, query, queryAnalysis);
    console.log(
      "[SEARCH RESULTS]",
      searchResults.map(r => ({
        id: r.node.id,
        name: r.node.name,
        type: r.node.node_type
      }))
    );

    // 2. Pull active goals (always included — they constrain strategic answers)
    const goals = await this.repo.getNodesByType(userId, 'GOAL', 10);
    const activeGoals = goals.filter(g => !g.is_archived);

    const nodes   = searchResults.map(r => r.node);
    const nodeIds = [...new Set([...nodes.map(n => n.id), ...activeGoals.map(g => g.id)])];
    console.log("[NODE IDS]", nodeIds);
    console.log(`[buildQueryContext] nodeIds=${JSON.stringify(nodeIds)}`);

    // 3. Batch-fetch edges for this subgraph (single query)
    const edgeMap = await this.repo.getEdgesByNodeIds(userId, nodeIds);
    console.log("[EDGE MAP SIZE]", edgeMap.size);
    const seen    = new Set<string>();
    const edges: GraphEdge[] = [];
    for (const es of edgeMap.values()) {
      for (const e of es) {
        if (!seen.has(e.id)) { seen.add(e.id); edges.push(e); }
      }
    }
    console.log(`[buildQueryContext] finalEdges=${edges.length}`);

    // 4. Build a nodeLookup covering retrieved nodes + all edge endpoints
    //    so edge summaries never fall back to raw UUIDs.
    const edgeNodeIds = new Set<string>();
    for (const e of edges) {
      edgeNodeIds.add(e.source_node_id);
      edgeNodeIds.add(e.target_node_id);
    }
    // IDs already loaded
    const knownIds = new Set([...nodes.map(n => n.id), ...activeGoals.map(g => g.id)]);
    const missingIds = [...edgeNodeIds].filter(id => !knownIds.has(id));
    const extraNodes = missingIds.length
      ? (await Promise.all(missingIds.map(id => this.repo.getNodeById(id, userId)))).filter((n): n is GraphNode => n !== null)
      : [];

    const nodeLookup = new Map<string, GraphNode>();
    for (const n of [...nodes, ...activeGoals, ...extraNodes]) nodeLookup.set(n.id, n);

    // 5. Build a compressed text summary (stays within token budget, Rule #6)
    const nodeLines = nodes.slice(0, 12).map(n =>
      `[${n.node_type}] ${n.name}${n.description ? ': ' + n.description.slice(0, 80) : ''} (imp:${n.importance_score.toFixed(2)})`,
    ).join('\n');

    // For relationship queries: surface only edges matching the queried relationship type first
    const relType = queryAnalysis.queryType === 'RELATIONSHIP_SEARCH' ? queryAnalysis.relationshipType : undefined;
    const sortedEdges = relType
      ? [...edges].sort((a, b) =>
          (a.relationship_type === relType ? 0 : 1) - (b.relationship_type === relType ? 0 : 1))
      : edges;

    const edgeLines = sortedEdges.slice(0, 15).map(e => {
      const src = nodeLookup.get(e.source_node_id)?.name ?? e.source_node_id;
      const tgt = nodeLookup.get(e.target_node_id)?.name ?? e.target_node_id;
      console.log("[EDGE NAME RESOLUTION]", { sourceId: e.source_node_id, sourceName: src, targetId: e.target_node_id, targetName: tgt });
      return `${src} --[${e.relationship_type}]--> ${tgt} (str:${e.strength.toFixed(2)})`;
    }).join('\n');

    const goalLines = activeGoals.slice(0, 5).map(g => {
      const daysSince = Math.floor((Date.now() - new Date(g.last_mentioned_at).getTime()) / 86_400_000);
      return `GOAL: ${g.name} (${daysSince}d ago)`;
    }).join('\n');

    // For relationship queries, lead with the relationship section
    const sections = queryAnalysis.queryType === 'RELATIONSHIP_SEARCH'
      ? [
          edgeLines ? `## Relationships:\n${edgeLines}` : '',
          nodeLines ? `## Entities involved:\n${nodeLines}` : '',
        ]
      : [
          nodeLines ? `## Relevant entities:\n${nodeLines}` : '',
          edgeLines ? `## Relationships:\n${edgeLines}` : '',
          goalLines ? `## Active goals:\n${goalLines}` : '',
        ];

    const summary = sections.filter(Boolean).join('\n\n');

    console.log("[FINAL NODE COUNT]", nodes.length);
    console.log("[FINAL EDGE COUNT]", edges.length);
    return { nodes, edges, goals: activeGoals, summary };
  }
}
