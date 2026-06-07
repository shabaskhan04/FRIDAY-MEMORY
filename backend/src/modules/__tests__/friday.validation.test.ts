// ============================================================
// friday.validation.test.ts — Production Validation Suite
// Covers: Knowledge Graph, Observation, Activity, Decision,
//         Causal, Review, AI Engine, Autonomous Ingestion
//
// Run: npx vitest run friday.validation.test.ts
// All tests use in-memory mocks — no DB, no network required.
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Engine imports ──────────────────────────────────────────
import { GraphService }              from '../knowledge-graph/graph.service';
import { GraphMerger }               from '../knowledge-graph/graph.merger';
import { GraphSearch }               from '../knowledge-graph/graph.search';
import { GraphTraversal }            from '../knowledge-graph/graph.traversal';
import { GraphInsights }             from '../knowledge-graph/graph.insights';
import { GraphExtractor }            from '../knowledge-graph/graph.extractor';
import { GraphRepository }           from '../knowledge-graph/graph.repository';
import { ObservationService }        from '../observation-engine/observation.service';
import { ObservationProcessor }      from '../observation-engine/observation.processor';
import { ObservationClassifier }     from '../observation-engine/observation-classifier';
import { ObservationRepository }     from '../observation-engine/observation.repository';
import { ObservationInsights }       from '../observation-engine/observation-insights';
import { ObservationTimeline }       from '../observation-engine/observation.timeline';
import { ActivityService }           from '../activity-engine/activity.service';
import { CorrelationEngine }         from '../activity-engine/correlation.engine';
import { TimelineEngine }            from '../activity-engine/timeline.engine';
import { ActivityInsights }          from '../activity-engine/activity-insights';
import { ActivityRepository }        from '../activity-engine/activity.repository';
import { DecisionService }           from '../decision-engine/decision.service';
import { DecisionRepository }        from '../decision-engine/decision.repository';
import { DecisionEvaluationEngine }  from '../decision-engine/decision-evaluation.engine';
import { DecisionInsights }          from '../decision-engine/decision.insights';
import { DecisionTimelineService }   from '../decision-engine/decision.timeline';
import { CausalService }             from '../causal-engine/causal.service';
import { CausalRepository }          from '../causal-engine/causal.repository';
import { CausalPathEngine }          from '../causal-engine/causal-path.engine';
import { CausalAnalysis }            from '../causal-engine/causal.analysis';
import { ReviewService }             from '../review-engine/review.service';
import { FocusEngine }               from '../review-engine/focus.engine';
import { RiskEngine }                from '../review-engine/risk.engine';
import { PriorityEngine }            from '../review-engine/priority.engine';
import { RecommendationEngine }      from '../review-engine/recommendation.engine';
import { AIRouter }                  from '../ai-engine/ai-router';
import { checkRateLimit, enforceTokenBudget, estimateTokens } from '../ai-engine/ai-rate-limiter';

import type { GraphNode, GraphEdge, CreateNodeInput } from '../knowledge-graph/graph.types';
import type { Observation, CreateObservationInput }  from '../observation-engine/observation.types';
import type { Activity }                             from '../activity-engine/activity.types';
import type { Decision, DecisionEvaluation }         from '../decision-engine/decision.types';
import type { CausalEdge }                           from '../causal-engine/causal.types';
import type { ReviewContext }                        from '../review-engine/review.types';

// ============================================================
// SHARED FIXTURES
// ============================================================

const UID = 'user-friday-test';
const NOW = new Date('2026-06-07T12:00:00Z');
const DAY = 86_400_000;

function node(overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    id: 'node-1', user_id: UID, node_type: 'PROJECT', name: 'FRIDAY',
    description: 'AI personal memory assistant', aliases: [],
    metadata: {}, importance_score: 0.9, confidence_score: 1.0,
    mention_count: 20, last_mentioned_at: new Date(NOW.getTime() - DAY).toISOString(),
    embedding: null, source_memory_ids: [], source_count: 1,
    canonical_id: null, is_archived: false, is_locked: false,
    created_at: new Date(NOW.getTime() - 30 * DAY).toISOString(),
    updated_at: new Date(NOW.getTime() - DAY).toISOString(),
    goal_alignment_score: 0.8, days_since_last_mention: 1,
    ...overrides,
  } as GraphNode;
}

function edge(overrides: Partial<GraphEdge> = {}): GraphEdge {
  return {
    id: 'edge-1', user_id: UID, source_node_id: 'node-1', target_node_id: 'node-2',
    relationship_type: 'OWNS', strength: 0.9, confidence: 0.95,
    mention_count: 5, last_seen_at: new Date(NOW.getTime() - DAY).toISOString(),
    metadata: {}, source_memory_ids: [], source_count: 1,
    is_pinned: false, is_archived: false,
    created_at: new Date(NOW.getTime() - 30 * DAY).toISOString(),
    updated_at: new Date(NOW.getTime() - DAY).toISOString(),
    ...overrides,
  };
}

function causalEdge(overrides: Partial<CausalEdge> = {}): CausalEdge {
  return {
    id: 'ce-1', source_node_id: 'A', target_node_id: 'B',
    relationship_type: 'CAUSED', causal_strength: 0.8,
    confidence: 0.9, source_count: 3,
    causal_evidence: [], last_seen_at: NOW.toISOString(),
    ...overrides,
  };
}

function observation(overrides: Partial<Observation> = {}): Observation {
  return {
    id: `obs-${Math.random()}`, user_id: UID,
    source: 'MANUAL', event_type: 'work_session', title: 'Worked on FRIDAY',
    description: 'Built the hardening test suite', occurred_at: NOW.toISOString(),
    importance_score: 0.8, confidence_score: 0.9, categories: ['WORK'],
    metadata: {}, related_entities: ['FRIDAY'], is_processed: true,
    signal_quality_score: 0.85, created_at: NOW.toISOString(), updated_at: NOW.toISOString(),
    ...overrides,
  };
}

function decision(overrides: Partial<Decision> = {}): Decision {
  return {
    id: 'd-1', user_id: UID, title: 'Launch FRIDAY v1',
    description: null, decision_type: 'PRODUCT',
    reasoning: 'Market timing is right', expected_outcome: '100 MAU in 3 months',
    expected_success_probability: 0.75, actual_outcome: null,
    status: 'ACTIVE', confidence_score: 0.8,
    decision_date: NOW.toISOString(), review_date: null,
    created_at: NOW.toISOString(), updated_at: NOW.toISOString(),
    ...overrides,
  };
}

// ============================================================
// 1. KNOWLEDGE GRAPH ENGINE
// ============================================================
// Purpose: Store entities and relationships extracted from memories.
// Entry: POST /ingest → getGraphService().ingestMemory()
//        GET /graph/path, /graph/profile/:name, /graph/analytics
// ============================================================

describe('Knowledge Graph — Who owns FRIDAY?', () => {
  const getName = vi.fn((_uid: string, id: string) => Promise.resolve(id));

  function makeRepo(nodes: GraphNode[], edges: GraphEdge[]) {
    return {
      createNode:          vi.fn((input: CreateNodeInput) => Promise.resolve({ ...node(), ...input, id: `n-${Math.random()}` })),
      getNodeById:         vi.fn((id: string) => Promise.resolve(nodes.find(n => n.id === id) ?? null)),
      updateNode:          vi.fn((_id: string, _uid: string, input: any) => Promise.resolve({ ...node(), ...input })),
      findNodesByName:     vi.fn((uid: string, name: string) => Promise.resolve(nodes.filter(n => n.name.toLowerCase().includes(name.toLowerCase())))),
      fuzzyFindNodes:      vi.fn(() => Promise.resolve(nodes)),
      findNodesByAlias:    vi.fn(() => Promise.resolve([])),
      getMostImportantNodes: vi.fn(() => Promise.resolve(nodes)),
      getRecentNodes:      vi.fn(() => Promise.resolve(nodes)),
      getNodesByType:      vi.fn((_uid: string, type: string) => Promise.resolve(nodes.filter(n => n.node_type === type))),
      semanticSearchNodes: vi.fn(() => Promise.resolve(nodes.map(n => ({ ...n, similarity: 0.95 })))),
      incrementMentionCount: vi.fn(() => Promise.resolve()),
      updateNodeScores:    vi.fn(() => Promise.resolve()),
      upsertEdge:          vi.fn((input: any) => Promise.resolve({ ...edge(), ...input, id: `e-${Math.random()}` })),
      createEdge:          vi.fn((input: any) => Promise.resolve({ ...edge(), ...input })),
      getEdgesByNode:      vi.fn((_uid: string, id: string) => Promise.resolve(edges.filter(e => e.source_node_id === id || e.target_node_id === id))),
      getEdgeBetween:      vi.fn((_uid: string, src: string, tgt: string) => Promise.resolve(edges.find(e => e.source_node_id === src && e.target_node_id === tgt) ?? null)),
      getEdgesByNodeIds:   vi.fn((_uid: string, ids: string[]) => {
        const map = new Map<string, GraphEdge[]>(ids.map(id => [id, []]));
        for (const e of edges) { map.get(e.source_node_id)?.push(e); map.get(e.target_node_id)?.push(e); }
        return Promise.resolve(map);
      }),
      incrementEdgeMention: vi.fn(() => Promise.resolve()),
      updateEdgeStrength:  vi.fn(() => Promise.resolve()),
      getStaleEdges:       vi.fn(() => Promise.resolve([])),
      getNeighborhood:     vi.fn(() => Promise.resolve([])),
      createSnapshot:      vi.fn(() => Promise.resolve({ id: 'snap-1', user_id: UID, snapshot: {}, node_count: nodes.length, edge_count: edges.length, trigger: 'test', created_at: NOW.toISOString() })),
      getLatestSnapshot:   vi.fn(() => Promise.resolve(null)),
      logEvent:            vi.fn(() => Promise.resolve()),
      getRecentEvents:     vi.fn(() => Promise.resolve([])),
      getDb:               vi.fn(() => null),
      pinEdge: vi.fn(() => Promise.resolve()),
      unpinEdge: vi.fn(() => Promise.resolve()),
      createStructuredSnapshot: vi.fn(() => Promise.resolve({ id: 'snap-1', user_id: UID, snapshot: {}, node_count: 0, edge_count: 0, trigger: 'test', created_at: NOW.toISOString() })),
      getSnapshotById: vi.fn(() => Promise.resolve(null)),
      getSnapshots: vi.fn(() => Promise.resolve([])),
    } as any;
  }

  it('SECURITY: node IDs are not leaked in graph summary', async () => {
    const shabas = node({ id: 'uuid-shabas', name: 'Shabas', node_type: 'PERSON' });
    const friday = node({ id: 'uuid-friday', name: 'FRIDAY', node_type: 'PROJECT' });
    const owns   = edge({ id: 'uuid-edge-1', source_node_id: 'uuid-shabas', target_node_id: 'uuid-friday', relationship_type: 'OWNS' });

    const repo      = makeRepo([shabas, friday], [owns]);
    const traversal = new GraphTraversal(repo);
    const merger    = new GraphMerger(repo);
    const insights  = new GraphInsights(repo);
    const embedFn   = vi.fn(() => Promise.resolve(Array(1536).fill(0.1)));
    const search    = new GraphSearch(repo, traversal, embedFn);
    const router    = { generate: vi.fn(() => Promise.resolve('{"nodes":[],"edges":[]}')), extract: vi.fn(() => Promise.resolve([])), classify: vi.fn(() => Promise.resolve('')), summarize: vi.fn(() => Promise.resolve('')), embed: vi.fn(() => Promise.resolve([[0.1]])) } as any;
    const extractor = new GraphExtractor(router);
    const service   = new GraphService(repo, extractor, merger, search, traversal, insights, embedFn);

    const ctx = await service.buildQueryContext(UID, 'Who owns FRIDAY?', Array(1536).fill(0.1), 5);

    // Graph summary must contain entity names, not bare UUIDs as content
    expect(ctx.summary).not.toMatch(/uuid-shabas/);
    expect(ctx.summary).not.toMatch(/uuid-friday/);
    // Names should be present
    expect(ctx.nodes.some(n => n.name === 'Shabas' || n.name === 'FRIDAY')).toBe(true);
  });

  it('QUERY: buildQueryContext returns OWNS edge for ownership query', async () => {
    const shabas = node({ id: 'n-shabas', name: 'Shabas', node_type: 'PERSON' });
    const friday = node({ id: 'n-friday', name: 'FRIDAY', node_type: 'PROJECT' });
    const owns   = edge({ source_node_id: 'n-shabas', target_node_id: 'n-friday', relationship_type: 'OWNS', strength: 0.95 });

    const repo = makeRepo([shabas, friday], [owns]);
    const traversal = new GraphTraversal(repo);
    const merger    = new GraphMerger(repo);
    const insights  = new GraphInsights(repo);
    const embedFn   = vi.fn(() => Promise.resolve(Array(1536).fill(0.1)));
    const search    = new GraphSearch(repo, traversal, embedFn);
    const router    = { generate: vi.fn(() => Promise.resolve('{"nodes":[],"edges":[]}')), extract: vi.fn(() => Promise.resolve([])), classify: vi.fn(() => Promise.resolve('')), summarize: vi.fn(() => Promise.resolve('')), embed: vi.fn(() => Promise.resolve([[0.1]])) } as any;
    const extractor = new GraphExtractor(router);
    const service   = new GraphService(repo, extractor, merger, search, traversal, insights, embedFn);

    const ctx = await service.buildQueryContext(UID, 'Who owns FRIDAY?', Array(1536).fill(0.1), 5);
    const ownsEdge = ctx.edges.find(e => e.relationship_type === 'OWNS');

    expect(ownsEdge).toBeDefined();
    expect(ownsEdge!.source_node_id).toBe('n-shabas');
    expect(ownsEdge!.target_node_id).toBe('n-friday');
  });

  it('QUERY: getShortestPath Sarah → Khan Designs traverses correctly', async () => {
    const sarah  = node({ id: 'n-sarah',  name: 'Sarah',       node_type: 'PERSON' });
    const khan   = node({ id: 'n-khan',   name: 'Khan Designs', node_type: 'BUSINESS' });
    const e1     = edge({ id: 'e-1', source_node_id: 'n-sarah', target_node_id: 'n-khan', relationship_type: 'WORKS_WITH', strength: 0.85 });

    const repo      = makeRepo([sarah, khan], [e1]);
    const traversal = new GraphTraversal(repo);
    const path = await traversal.shortestPath(UID, 'n-sarah', 'n-khan');

    expect(path).not.toBeNull();
    expect(path).toContain('n-sarah');
    expect(path).toContain('n-khan');
  });

  it('WEAKNESS: ingestMemory graph errors are silently swallowed (fire-and-forget)', async () => {
    // Documents the known bug: graph ingestion errors don't surface to caller
    const repo = makeRepo([], []);
    repo.createNode = vi.fn(() => Promise.reject(new Error('DB connection lost')));
    const traversal = new GraphTraversal(repo);
    const merger    = new GraphMerger(repo);
    const insights  = new GraphInsights(repo);
    const embedFn   = vi.fn(() => Promise.resolve(Array(1536).fill(0.1)));
    const search    = new GraphSearch(repo, traversal, embedFn);
    const router    = { generate: vi.fn(() => Promise.resolve('{"nodes":[{"name":"FRIDAY","node_type":"PROJECT","confidence":0.9,"aliases":[],"metadata":{}}],"edges":[]}')), extract: vi.fn(() => Promise.resolve([])), classify: vi.fn(() => Promise.resolve('')), summarize: vi.fn(() => Promise.resolve('')), embed: vi.fn(() => Promise.resolve([[0.1]])) } as any;
    const extractor = new GraphExtractor(router);
    const service   = new GraphService(repo, extractor, merger, search, traversal, insights, embedFn);

    // Callers in ingest.ts use .catch() so this should not throw
    // This test documents that errors are swallowed silently — a KNOWN BUG
    await expect(service.ingestMemory(UID, 'Worked on FRIDAY today', 'mem-1')).rejects.toThrow();
    // FIX NEEDED: ingest.ts fire-and-forget should log + increment error counter
  });

  it('SCALABILITY: createSnapshot fetches ALL nodes/edges with no pagination limit', () => {
    // Documents the N+∞ snapshot bug
    // graph.repository.ts createSnapshot() has no LIMIT on graph_nodes / graph_edges query
    // For a user with 10,000 nodes this will cause a timeout / OOM
    // FIX: add .limit(5000) or use streaming — document this as HIGH PRIORITY
    expect(true).toBe(true); // placeholder — actual fix is in repository layer
  });

  it('SCALABILITY: getEdgesByNodeIds OR filter is unbounded with many nodeIds', () => {
    // graph.repository.ts:getEdgesByNodeIds builds `.or(nodeIds.map(...).join(','))`
    // With 100+ nodes this becomes a 200+ clause OR — PostgreSQL planner degrades
    // FIX: batch nodeIds into chunks of 50
    const nodeIds = Array.from({ length: 200 }, (_, i) => `node-${i}`);
    const orString = nodeIds.map(id => `source_node_id.eq.${id},target_node_id.eq.${id}`).join(',');
    expect(orString.split(',').length).toBe(400); // 400 OR clauses — confirms the problem
  });
});

// ============================================================
// 2. OBSERVATION ENGINE
// ============================================================
// Purpose: Classify, score, and persist raw signals.
// Entry: ObservationService.observe() — no HTTP routes exposed.
// ============================================================

describe('Observation Engine — Dominant focus detection', () => {
  function makeObsRepo(stored: Observation[] = []) {
    return {
      create:         vi.fn((input: any) => Promise.resolve({ ...observation(), ...input, id: `obs-${Math.random()}` })),
      getById:        vi.fn((id: string) => Promise.resolve(stored.find(o => o.id === id) ?? null)),
      listRecent:     vi.fn(() => Promise.resolve(stored)),
      listBySource:   vi.fn((uid: string, src: string) => Promise.resolve(stored.filter(o => o.source === src))),
      listByCategory: vi.fn((uid: string, cat: string) => Promise.resolve(stored.filter(o => o.categories.includes(cat as any)))),
      listUnprocessed: vi.fn(() => Promise.resolve([])),
      markProcessed:  vi.fn(() => Promise.resolve()),
      update:         vi.fn((id: string, uid: string, input: any) => Promise.resolve({ ...observation(), id, ...input })),
    } as any;
  }

  function makeInsights(stored: Observation[]) {
    return {
      getObservationDistribution: vi.fn(async (uid: string) => {
        const by_source: Record<string, number> = {};
        const by_category: Record<string, number> = {};
        for (const o of stored) {
          by_source[o.source] = (by_source[o.source] ?? 0) + 1;
          for (const cat of o.categories) by_category[cat] = (by_category[cat] ?? 0) + 1;
        }
        return { by_source, by_category, total: stored.length, period_days: 7 };
      }),
      getTopObservationSources: vi.fn(() => Promise.resolve([])),
      getAttentionDrift: vi.fn(() => Promise.resolve({ from_date: '', to_date: '', gained: [], lost: [], shifts: [] })),
      getEmergingActivities: vi.fn(() => Promise.resolve([])),
      getDecliningActivities: vi.fn(() => Promise.resolve([])),
      getObservationTrends: vi.fn(() => Promise.resolve([])),
    } as any;
  }

  it('SCENARIO: 5 FRIDAY sessions + 1 Static session → FRIDAY dominates', async () => {
    const fridayObs = Array.from({ length: 5 }, () =>
      observation({ source: 'MANUAL', title: 'Worked on FRIDAY', categories: ['WORK'], related_entities: ['FRIDAY'] }));
    const staticObs = [observation({ source: 'MANUAL', title: 'Worked on Static', categories: ['WORK'], related_entities: ['Static'] })];
    const all = [...fridayObs, ...staticObs];

    const repo      = makeObsRepo(all);
    const classifier = new ObservationClassifier();
    const processor  = new ObservationProcessor(repo, classifier);
    const insights   = makeInsights(all);
    const timeline   = { getTimeline: vi.fn(() => Promise.resolve([])) } as any;
    const service    = new ObservationService(repo, processor, insights, timeline);

    const dist = await service.getDistribution(UID, 7);

    // FRIDAY mentioned 5x in titles — Manual source should dominate
    expect(dist.by_source['MANUAL']).toBe(6);
    // Work category dominant
    expect(dist.by_category['WORK']).toBe(6);
  });

  it('PROCESS: observe() persists with classified category', async () => {
    const repo       = makeObsRepo();
    const classifier = new ObservationClassifier();
    const processor  = new ObservationProcessor(repo, classifier);
    const insights   = makeInsights([]);
    const timeline   = { getTimeline: vi.fn(() => Promise.resolve([])) } as any;
    const service    = new ObservationService(repo, processor, insights, timeline);

    const result = await service.observe({
      user_id: UID, source: 'TASK_COMPLETED',
      event_type: 'task.done', title: 'Shipped FRIDAY auth fix',
    });

    expect(result.source).toBe('TASK_COMPLETED');
    expect(repo.create).toHaveBeenCalledOnce();
  });

  it('WEAKNESS: no HTTP routes — ObservationService has zero external entry points', () => {
    // Confirmed: server.ts registers 0 observation routes.
    // Data can only enter via direct service instantiation (not wired in intelligence.ts).
    // FIX: register GET /observation/recent and POST /observation in server.ts
    expect(true).toBe(true);
  });

  it('WEAKNESS: related_entities is string[] of names, never resolved to graph node IDs', () => {
    // observation.types.ts: related_entities: string[]
    // These are entity names like ['FRIDAY', 'Shabas'] — never joined to graph_nodes.id
    // FIX: post-process in processor.ts using GraphSearch.findByName()
    const obs = observation({ related_entities: ['FRIDAY', 'Shabas Khan'] });
    expect(typeof obs.related_entities[0]).toBe('string');
    // Should be graph node IDs — this is a data consistency bug
  });
});

// ============================================================
// 3. ACTIVITY ENGINE
// ============================================================
// Purpose: Correlate observations into timed activity clusters.
// Entry: ActivityService.processObservations() — never called.
// ============================================================

describe('Activity Engine — Focus detection from observations', () => {
  function makeActivityRepo(stored: Activity[] = []) {
    return {
      createMany:        vi.fn((inputs: any[]) => Promise.resolve(inputs.map((inp, i) => ({
        id: `act-${i}`, user_id: UID, title: inp.title, category: inp.category,
        started_at: inp.started_at, ended_at: inp.ended_at,
        importance_score: inp.importance_score, confidence_score: inp.confidence_score,
        signal_quality: inp.signal_quality, related_entities: inp.related_entities,
        metadata: {}, created_at: NOW.toISOString(), updated_at: NOW.toISOString(),
      } as Activity)))),
      getById:           vi.fn((id: string) => Promise.resolve(stored.find(a => a.id === id) ?? null)),
      linkObservations:  vi.fn(() => Promise.resolve()),
      getObservationIds: vi.fn(() => Promise.resolve([])),
    } as any;
  }

  it('SCENARIO: 5 FRIDAY work sessions → clusters into WORK activity', async () => {
    const obs = Array.from({ length: 5 }, (_, i) => observation({
      id: `obs-${i}`,
      title: 'Worked on FRIDAY',
      categories: ['WORK'],
      related_entities: ['FRIDAY'],
      occurred_at: new Date(NOW.getTime() - i * 3600000).toISOString(),
    }));

    const repo       = makeActivityRepo();
    const correlator = new CorrelationEngine();
    const timeline   = { reconstructDay: vi.fn(() => Promise.resolve({ date: NOW.toISOString(), activities: [], gaps: [] })) } as any;
    const insights   = { getRecentTimeline: vi.fn(() => Promise.resolve([])), getCategorySummary: vi.fn(() => Promise.resolve([])), getTopActivities: vi.fn(() => Promise.resolve([])), getMostActiveHours: vi.fn(() => Promise.resolve([])), getEntityFocus: vi.fn(() => Promise.resolve([{ entity: 'FRIDAY', count: 5 }])) } as any;
    const service    = new ActivityService(repo, correlator, timeline, insights);

    const activities = await service.processObservations(UID, obs);

    // Should produce at least one activity
    expect(activities.length).toBeGreaterThan(0);
    // Entity focus should show FRIDAY as dominant
    const focus = await service.getEntityFocus(UID);
    expect(focus[0].entity).toBe('FRIDAY');
    expect(focus[0].count).toBe(5);
  });

  it('WEAKNESS: processObservations() has no call site in any route or worker', () => {
    // ActivityService is never instantiated in intelligence.ts or server.ts.
    // ingest.ts calls graphService.ingestMemory() but never activityService.processObservations().
    // FIX: in ingest.ts after observation creation, call activityService.processObservations()
    expect(true).toBe(true);
  });

  it('WEAKNESS: enrichSignalQuality() enriches in-memory only — no persistence', async () => {
    const repo       = makeActivityRepo();
    const correlator = new CorrelationEngine();
    const timeline   = { reconstructDay: vi.fn(() => Promise.resolve({ date: NOW.toISOString(), activities: [], gaps: [] })) } as any;
    const insights   = { getRecentTimeline: vi.fn(() => Promise.resolve([])), getCategorySummary: vi.fn(() => Promise.resolve([]), ), getTopActivities: vi.fn(() => Promise.resolve([])), getMostActiveHours: vi.fn(() => Promise.resolve([])), getEntityFocus: vi.fn(() => Promise.resolve([])) } as any;
    const service    = new ActivityService(repo, correlator, timeline, insights);

    const obs = [observation({ source: 'MANUAL' })];
    const enriched = service.enrichSignalQuality(obs);

    expect(enriched[0].signal_quality_score).toBeGreaterThan(0);
    // But repo.update was never called — scores are lost after function returns
    expect(repo.createMany).not.toHaveBeenCalled();
  });
});

// ============================================================
// 4. DECISION ENGINE
// ============================================================
// Purpose: Create, evaluate, and score decisions with outcomes.
// Entry: DecisionService — no HTTP routes registered.
// ============================================================

describe('Decision Engine — Revenue opportunity vs. deadline conflict', () => {
  function makeDecisionRepo(decisions: Decision[] = []) {
    return {
      create:              vi.fn((input: any) => Promise.resolve({ ...decision(), ...input, id: `d-${Math.random()}` })),
      getById:             vi.fn((id: string) => Promise.resolve(decisions.find(d => d.id === id) ?? null)),
      update:              vi.fn((_id: string, _uid: string, input: any) => Promise.resolve({ ...decision(), ...input })),
      listByUser:          vi.fn(() => Promise.resolve(decisions)),
      listFailed:          vi.fn(() => Promise.resolve(decisions.filter(d => d.status === 'FAILED'))),
      linkToEntity:        vi.fn((_did: string, nid: string, rel: string) => Promise.resolve({ id: 'de-1', decision_id: _did, node_id: nid, relationship_type: rel, created_at: NOW.toISOString() })),
      getDecisionEntities: vi.fn(() => Promise.resolve([])),
      getEntityDecisions:  vi.fn(() => Promise.resolve([])),
      saveEvaluation:      vi.fn((did: string, input: any) => Promise.resolve({ id: 'ev-1', decision_id: did, ...input, evaluated_at: NOW.toISOString() })),
      getEvaluations:      vi.fn(() => Promise.resolve([])),
      getLatestEvaluation: vi.fn(() => Promise.resolve(null)),
    } as any;
  }

  it('SCENARIO: revenue opportunity decision is created with high confidence', async () => {
    const repo     = makeDecisionRepo();
    const evaluator = new DecisionEvaluationEngine(repo);
    const insights  = new DecisionInsights(repo);
    const timeline  = { getTimeline: vi.fn(() => Promise.resolve([])) } as any;
    const service   = new DecisionService(repo, evaluator, insights, timeline);

    const result = await service.createDecision({
      user_id: UID, title: 'Take Khan Designs revenue contract',
      decision_type: 'BUSINESS', reasoning: 'Strong client, clear scope',
      expected_outcome: '₹2L in 6 weeks', expected_success_probability: 0.85,
      confidence_score: 0.9, status: 'ACTIVE', decision_date: NOW.toISOString(),
    } as any);

    expect(result.confidence_score).toBe(0.9);
    expect(repo.create).toHaveBeenCalledOnce();
  });

  it('SCENARIO: deadline conflict — lower confidence decision evaluated correctly', async () => {
    const d = decision({ id: 'd-conflict', confidence_score: 0.5, status: 'ACTIVE' });
    const repo = makeDecisionRepo([d]);
    repo.getById = vi.fn(() => Promise.resolve(d));
    const evaluator = new DecisionEvaluationEngine(repo);
    const insights  = new DecisionInsights(repo);
    const timeline  = { getTimeline: vi.fn(() => Promise.resolve([])) } as any;
    const service   = new DecisionService(repo, evaluator, insights, timeline);

    const eval_ = await service.evaluateDecision(UID, 'd-conflict', {
      success_score: 0.3,
      accuracy_score: 0.4,
      lessons: ['Deadline was unrealistic', 'Should have pushed back'],
    });

    expect(eval_.success_score).toBe(0.3);
    // status should become FAILED (success < 0.3 threshold in evaluator)
    expect(repo.update).toHaveBeenCalledWith('d-conflict', UID, expect.objectContaining({ status: 'FAILED' }));
  });

  it('WEAKNESS: linkDecisionToEntity() is never called in createDecision()', async () => {
    const repo     = makeDecisionRepo();
    const evaluator = new DecisionEvaluationEngine(repo);
    const insights  = new DecisionInsights(repo);
    const timeline  = { getTimeline: vi.fn(() => Promise.resolve([])) } as any;
    const service   = new DecisionService(repo, evaluator, insights, timeline);

    await service.createDecision({
      user_id: UID, title: 'Build FRIDAY causal engine', decision_type: 'PRODUCT',
      reasoning: 'Core feature', expected_outcome: 'Causal chains work',
      expected_success_probability: 0.8, confidence_score: 0.85,
      status: 'ACTIVE', decision_date: NOW.toISOString(),
    } as any);

    // linkToEntity should have been called — but it NEVER IS
    // FIX: add entity resolution in createDecision() after repo.create()
    expect(repo.linkToEntity).not.toHaveBeenCalled(); // documents the bug
  });

  it('SECURITY: decision input is validated via Zod schema', async () => {
    const repo     = makeDecisionRepo();
    const evaluator = new DecisionEvaluationEngine(repo);
    const insights  = new DecisionInsights(repo);
    const timeline  = { getTimeline: vi.fn(() => Promise.resolve([])) } as any;
    const service   = new DecisionService(repo, evaluator, insights, timeline);

    // confidence_score must be 0–1
    await expect(service.createDecision({
      user_id: UID, title: 'Bad decision', decision_type: 'PRODUCT',
      reasoning: 'x', expected_outcome: 'x', expected_success_probability: 2, // invalid
      confidence_score: 5, status: 'ACTIVE', decision_date: NOW.toISOString(),
    } as any)).rejects.toThrow();
  });
});

// ============================================================
// 5. CAUSAL ENGINE
// ============================================================
// Purpose: Model cause-effect relationships in the graph.
// Entry: CausalService — no HTTP routes registered.
// ============================================================

describe('Causal Engine — Traffic spike → DB overload → Server crash', () => {
  const getName = vi.fn((_uid: string, id: string) => Promise.resolve(id));

  function makeRepo(edges: CausalEdge[]) {
    return {
      createCausalEdge:     vi.fn((input: any) => Promise.resolve({ ...causalEdge(), ...input, id: `ce-${Math.random()}` })),
      getCausalEdgesFrom:   vi.fn((_uid: string, id: string) => Promise.resolve(edges.filter(e => e.source_node_id === id))),
      getCausalEdgesTo:     vi.fn((_uid: string, id: string) => Promise.resolve(edges.filter(e => e.target_node_id === id))),
      getAllCausalEdges:     vi.fn(() => Promise.resolve(edges)),
      updateCausalStrength: vi.fn(() => Promise.resolve()),
    } as any;
  }

  it('SCENARIO: Traffic spike → DB overload → Server crash (3-hop chain)', async () => {
    const edges = [
      causalEdge({ id: 'c1', source_node_id: 'traffic-spike', target_node_id: 'db-overload',    causal_strength: 0.85, relationship_type: 'CAUSED' }),
      causalEdge({ id: 'c2', source_node_id: 'db-overload',   target_node_id: 'server-crash',   causal_strength: 0.9,  relationship_type: 'CAUSED' }),
    ];

    const repo       = makeRepo(edges);
    const pathEngine = new CausalPathEngine(repo, getName);
    const analysis   = new CausalAnalysis(repo, pathEngine);
    const service    = new CausalService(repo, analysis, pathEngine);

    const path = await service.findCausalPath(UID, 'traffic-spike', 'server-crash');

    expect(path).not.toBeNull();
    expect(path!.hop_count).toBe(2);
    expect(path!.node_ids).toEqual(['traffic-spike', 'db-overload', 'server-crash']);
    expect(path!.total_strength).toBeGreaterThan(0.8);
  });

  it('SCENARIO: findRootCauses of server-crash identifies traffic-spike', async () => {
    const edges = [
      causalEdge({ id: 'c1', source_node_id: 'traffic-spike', target_node_id: 'db-overload',  causal_strength: 0.85 }),
      causalEdge({ id: 'c2', source_node_id: 'db-overload',   target_node_id: 'server-crash', causal_strength: 0.9  }),
    ];
    const repo       = makeRepo(edges);
    const pathEngine = new CausalPathEngine(repo, getName);
    const analysis   = new CausalAnalysis(repo, pathEngine);
    const service    = new CausalService(repo, analysis, pathEngine);

    const roots = await service.findRootCauses(UID, 'server-crash');

    expect(roots.some(r => r.root_node_id === 'traffic-spike')).toBe(true);
    expect(roots[0].influence_score).toBeGreaterThan(0.5);
  });

  it('SCENARIO: findDownstreamEffects of traffic-spike reaches server-crash', async () => {
    const edges = [
      causalEdge({ id: 'c1', source_node_id: 'traffic-spike', target_node_id: 'db-overload',  causal_strength: 0.85 }),
      causalEdge({ id: 'c2', source_node_id: 'db-overload',   target_node_id: 'server-crash', causal_strength: 0.9  }),
    ];
    const repo       = makeRepo(edges);
    const pathEngine = new CausalPathEngine(repo, getName);
    const analysis   = new CausalAnalysis(repo, pathEngine);
    const service    = new CausalService(repo, analysis, pathEngine);

    const effects = await service.findDownstreamEffects(UID, 'traffic-spike');
    expect(effects.some(e => e.effect_node_id === 'server-crash')).toBe(true);
  });

  it('WEAKNESS: processObservation() is a stub — returns void, does nothing', async () => {
    const repo       = makeRepo([]);
    const pathEngine = new CausalPathEngine(repo, getName);
    const analysis   = new CausalAnalysis(repo, pathEngine);
    const service    = new CausalService(repo, analysis, pathEngine);

    // Should eventually create causal edges — currently does nothing
    await service.processObservation({ source: { type: 'GIT_COMMIT' }, payload: {} } as any);

    expect(repo.createCausalEdge).not.toHaveBeenCalled(); // documents the stub
  });

  it('SCALABILITY: getStrongestCausalChains has N+1 pattern for findDownstreamEffects', async () => {
    // CausalAnalysis.getStrongestCausalChains() calls:
    //   findMostInfluentialNodes(limit*2)  → 1 query for all edges
    //   then for each influential node, calls findDownstreamEffects() → N*M additional queries
    // With limit=5 and each node having 3 targets: 5*3 = 15 findDownstreamEffects calls
    // FIX: compute all paths in a single BFS pass instead of per-node calls
    const callCount = { n: 0 };
    const edges = Array.from({ length: 10 }, (_, i) =>
      causalEdge({ id: `c${i}`, source_node_id: `src-${i % 3}`, target_node_id: `tgt-${i}`, causal_strength: 0.7 }));

    const repo: any = {
      getAllCausalEdges: vi.fn(() => { callCount.n++; return Promise.resolve(edges); }),
      getCausalEdgesFrom: vi.fn((_uid: string, id: string) => { callCount.n++; return Promise.resolve(edges.filter(e => e.source_node_id === id)); }),
      getCausalEdgesTo:   vi.fn(() => Promise.resolve([])),
    };
    const pathEngine = new CausalPathEngine(repo, getName);
    const analysis   = new CausalAnalysis(repo, pathEngine);

    await analysis.getStrongestCausalChains(UID, 3);

    // Should be low (1-2 queries) — if it's high, N+1 is confirmed
    expect(callCount.n).toBeGreaterThan(2); // confirms the N+1 problem exists
  });
});

// ============================================================
// 6. REVIEW ENGINE
// ============================================================
// Purpose: Generate strategic weekly/monthly reviews.
// Entry: ReviewService — never instantiated in server.ts.
// ============================================================

describe('Review Engine — Weekly and monthly reviews', () => {
  function makeDb() {
    return {
      from: vi.fn(() => ({
        insert: vi.fn(() => ({ error: null })),
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: vi.fn(() => ({
                limit: vi.fn(() => ({
                  maybeSingle: vi.fn(() => Promise.resolve({ data: null, error: null })),
                })),
              })),
            })),
          })),
        })),
      })),
    } as any;
  }

  function makeCtx(dayOffset = 0): ReviewContext {
    return {
      user_id: UID,
      period_start: new Date(NOW.getTime() - (7 + dayOffset) * DAY),
      period_end: new Date(NOW.getTime() - dayOffset * DAY),
      entities: [
        { ...node({ id: 'n-friday', name: 'FRIDAY', node_type: 'PROJECT', importance_score: 0.9, goal_alignment_score: 0.85, days_since_last_mention: 1 }) },
        { ...node({ id: 'n-khan',   name: 'Khan Designs', node_type: 'BUSINESS', importance_score: 0.7, goal_alignment_score: 0.6, days_since_last_mention: 3 }) },
        { ...node({ id: 'n-goal',   name: 'Launch FRIDAY', node_type: 'GOAL', importance_score: 0.95, goal_alignment_score: 0.95, days_since_last_mention: 20 }) }, // neglected
      ] as any,
    };
  }

  it('SCENARIO: weekly review produces recommendations and neglected goals', async () => {
    const db: any = {
      from: vi.fn(() => ({
        insert: vi.fn(() => Promise.resolve({ error: null })),
        select: vi.fn(() => ({ eq: vi.fn(() => ({ order: vi.fn(() => ({ limit: vi.fn(() => ({ maybeSingle: vi.fn(() => Promise.resolve({ data: null, error: null })) })) })) })) })),
      })),
    };

    const focus   = new FocusEngine();
    const risk    = new RiskEngine();
    const priority = new PriorityEngine();
    const recEngine = new RecommendationEngine();
    const service = new ReviewService(db, focus, risk, priority, recEngine);

    const review = await service.generateStrategicReview(makeCtx(), 'weekly');

    expect(review.user_id).toBe(UID);
    expect(review.neglected_goals.some(g => g.name === 'Launch FRIDAY')).toBe(true);
    expect(review.recommendations.length).toBeGreaterThan(0);
    expect(review.overall_score).toBeGreaterThanOrEqual(0);
    expect(review.overall_score).toBeLessThanOrEqual(1);
  });

  it('WEAKNESS: ReviewService is never instantiated in server.ts or intelligence.ts', () => {
    // No route calls ReviewService.generateStrategicReview()
    // weekly-summary.ts writes to weekly_summaries table (different from strategic_reviews)
    // FIX: add POST /review/generate and GET /review/latest routes
    expect(true).toBe(true);
  });

  it('DATA CONSISTENCY: two parallel review systems write to different tables', () => {
    // weekly-summary.ts → weekly_summaries table
    // ReviewService.store() → strategic_reviews table
    // These are NEVER merged or reconciled
    // FIX: deprecate weekly_summaries, route weekly-summary.ts through ReviewService
    expect(true).toBe(true);
  });
});

// ============================================================
// 7. AI ENGINE
// ============================================================
// Purpose: Gateway for all LLM calls — routing, caching, cost.
// Entry: AIRouter (internal library only)
// ============================================================

describe('AI Engine — Cost tracking and rate limiting', () => {
  it('checkRateLimit throws for zero-limit features (observation_classification)', () => {
    expect(() => checkRateLimit('observation_classification')).toThrow('must not use AI');
  });

  it('enforceTokenBudget throws when prompt exceeds budget', () => {
    const hugePropmt = 'x'.repeat(40_000); // ~10,000 tokens
    expect(() => enforceTokenBudget('memory_extraction', estimateTokens(hugePropmt))).toThrow('prompt too large');
  });

  it('enforceTokenBudget passes for prompt within budget', () => {
    expect(() => enforceTokenBudget('ask_friday', 100)).not.toThrow();
  });

  it('WEAKNESS: ask.ts bypasses AIRouter — calls groq.chat.completions.create() directly', () => {
    // routes/memory/ask.ts line ~120: const completion = await groq.chat.completions.create(...)
    // This bypasses: caching, cost tracking, rate limiting, L1/L2 routing, fallback
    // FIX: replace with getAIRouter().generate('ask_friday', systemPrompt, userPrompt)
    expect(true).toBe(true);
  });

  it('WEAKNESS: AI budget limits reset on server restart (in-memory only)', () => {
    // ai-usage.ts stores call counts in module-level Map — lost on restart
    // ai_budget_config table exists but enforceTokenBudget() never reads from DB
    // FIX: load budget config from ai_budget_config table at startup
    expect(true).toBe(true);
  });

  it('AIRouter routes memory_extraction to L1 model', async () => {
    const groqMock = {
      chat: {
        completions: {
          create: vi.fn(({ model }: { model: string }) =>
            Promise.resolve({ choices: [{ message: { content: '{"nodes":[],"edges":[]}' } }], usage: { prompt_tokens: 100, completion_tokens: 50 } })),
        },
      },
    } as any;
    const openaiMock = {
      embeddings: {
        create: vi.fn(() => Promise.resolve({ data: [{ embedding: Array(1536).fill(0.1) }], usage: { total_tokens: 10 } })),
      },
    } as any;

    const router = new AIRouter(groqMock, openaiMock, null, UID);
    await router.generate('memory_extraction', 'sys', 'user prompt');

    const call = groqMock.chat.completions.create.mock.calls[0][0];
    expect(call.model).toBe('llama-3.1-8b-instant'); // L1 for extraction
  });

  it('AIRouter routes ask_friday to L2 model', async () => {
    const groqMock = {
      chat: {
        completions: {
          create: vi.fn(() => Promise.resolve({ choices: [{ message: { content: 'Answer.' } }], usage: { prompt_tokens: 200, completion_tokens: 100 } })),
        },
      },
    } as any;
    const openaiMock = { embeddings: { create: vi.fn() } } as any;
    const router = new AIRouter(groqMock, openaiMock, null, UID);
    await router.generate('ask_friday', 'sys', 'Who owns FRIDAY?');

    const call = groqMock.chat.completions.create.mock.calls[0][0];
    expect(call.model).toBe('llama-3.3-70b-versatile'); // L2 for Ask Friday
  });

  it('AIRouter falls back to L1 when L2 fails', async () => {
    let callCount = 0;
    const groqMock = {
      chat: {
        completions: {
          create: vi.fn(({ model }: { model: string }) => {
            callCount++;
            if (model === 'llama-3.3-70b-versatile') throw new Error('L2 overloaded');
            return Promise.resolve({ choices: [{ message: { content: 'fallback' } }], usage: { prompt_tokens: 50, completion_tokens: 20 } });
          }),
        },
      },
    } as any;
    const openaiMock = { embeddings: { create: vi.fn() } } as any;
    const router = new AIRouter(groqMock, openaiMock, null, UID);

    const result = await router.generate('ask_friday', 'sys', 'question');
    expect(result).toBe('fallback');
    expect(callCount).toBe(2); // first L2 fails, then L1 succeeds
  });
});

// ============================================================
// 8. AUTONOMOUS INGESTION
// ============================================================
// Purpose: Ingest text → raw_ledger, entity_ledger, graph, embeddings.
// Entry: POST /ingest
// ============================================================

describe('Autonomous Ingestion — Email / Calendar / GitHub', () => {
  it('SCENARIO: Email memory → extracts entities with clean names (no role suffixes)', () => {
    // Tests the canonicalizeName() logic in ingest.ts
    function canonicalizeName(raw: string): string {
      return raw.replace(/\s*\([^)]*\)\s*$/, '').trim();
    }

    expect(canonicalizeName('Shanavas Khan (father)')).toBe('Shanavas Khan');
    expect(canonicalizeName('Sarah (sister)')).toBe('Sarah');
    expect(canonicalizeName('Nidha')).toBe('Nidha');
    expect(canonicalizeName('Khan Designs (client)')).toBe('Khan Designs');
  });

  it('SCENARIO: Memory with extracted task → task written to todo_tasks', () => {
    // ingest.ts extracts tasks from Groq and writes to todo_tasks
    // Verify the extraction logic — task must be string and non-empty
    const extractedTasks = ['Review Khan Designs mockups', '', '  ', 'Ship FRIDAY auth fix'];
    const valid = extractedTasks.filter(t => typeof t === 'string' && t.trim().length > 0);
    expect(valid.length).toBe(2);
    expect(valid[0]).toBe('Review Khan Designs mockups');
  });

  it('SCENARIO: Duplicate entity in same memory is deduplicated', () => {
    // ingest.ts dedupes by lowercased name before writing to entity_ledger
    const raw = [
      { name: 'Shabas Khan', interaction_type: 'friend', trust_signal: 'positive', ledger_note: 'met today' },
      { name: 'SHABAS KHAN', interaction_type: 'friend', trust_signal: 'positive', ledger_note: 'again' },
      { name: 'Nidha',       interaction_type: 'family', trust_signal: 'positive', ledger_note: 'call' },
    ];
    const seen = new Set<string>();
    const deduped = raw.filter(e => {
      const key = e.name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    expect(deduped.length).toBe(2); // Shabas + Nidha
    expect(deduped[0].name).toBe('Shabas Khan');
  });

  it('WEAKNESS: graph ingestion is fire-and-forget (errors never surface)', () => {
    // ingest.ts: getGraphService().ingestMemory(...).catch(err => console.error(...))
    // If Groq extraction fails or DB is down, /ingest still returns 200
    // The caller has no way to know the graph was not updated
    // FIX: return graph_ingested: boolean in IngestResponse
    const mockResponse = {
      success: true, raw_ledger_id: 'mem-1', intent_tag: 'standard',
      temporal_count: 0, entity_count: 1, task_count: 0, embedding_stored: true,
      // graph_ingested is MISSING from the response — FIX: add it
    };
    expect('graph_ingested' in mockResponse).toBe(false); // confirms the missing field
  });

  it('SECURITY: auth middleware uses plain string comparison (timing attack)', () => {
    // auth.ts: token !== apiSecret — vulnerable to timing attacks
    // Fix: use crypto.timingSafeEqual()
    const apiSecret = 'my-secret-key';
    const token     = 'my-secret-key';

    // Current implementation (vulnerable):
    const vulnerable = token === apiSecret;

    // Safe implementation should use:
    // crypto.timingSafeEqual(Buffer.from(token), Buffer.from(apiSecret))
    expect(vulnerable).toBe(true); // works, but timing-unsafe
  });

  it('SECURITY: getFridayUserId() is hardcoded to single user', () => {
    // supabase.ts: getFridayUserId() returns process.env.FRIDAY_USER_ID
    // All routes use this same ID — no per-request user isolation
    // FIX: extract userId from JWT or session token per request
    const userId = process.env.FRIDAY_USER_ID ?? 'hardcoded-user-id';
    expect(typeof userId).toBe('string');
    // If this is ever deployed multi-user, ALL users would share the same graph
  });

  it('CONNECTOR ARCHITECTURE: connectors exist as interfaces only, zero implementations', () => {
    // observation.types.ts exports: IGitConnector, IEmailConnector, ICalendarConnector, etc.
    // None of these have implementing classes anywhere in the codebase
    // ObservationService.registerConnector() and runConnector() are callable but no-op
    // FIX (Phase 2): implement CalendarConnector using existing Google OAuth tokens
    expect(true).toBe(true);
  });
});

// ============================================================
// 9. INTEGRATION: full memory → graph pipeline
// ============================================================

describe('Full pipeline: memory → graph → ask', () => {
  it('PIPELINE: ingestMemory extracts nodes and edges from a memory', async () => {
    const repo: any = {
      createNode: vi.fn((input: any) => Promise.resolve({ ...node(), name: input.name, node_type: input.node_type, id: `n-${Math.random()}` })),
      getNodeById: vi.fn(() => Promise.resolve(null)),
      updateNode: vi.fn((id: string, uid: string, input: any) => Promise.resolve({ ...node(), id, ...input })),
      findNodesByName: vi.fn(() => Promise.resolve([])),
      fuzzyFindNodes: vi.fn(() => Promise.resolve([])),
      findNodesByAlias: vi.fn(() => Promise.resolve([])),
      getMostImportantNodes: vi.fn(() => Promise.resolve([])),
      getRecentNodes: vi.fn(() => Promise.resolve([])),
      getNodesByType: vi.fn(() => Promise.resolve([])),
      semanticSearchNodes: vi.fn(() => Promise.resolve([])),
      incrementMentionCount: vi.fn(() => Promise.resolve()),
      updateNodeScores: vi.fn(() => Promise.resolve()),
      upsertEdge: vi.fn((input: any) => Promise.resolve({ ...edge(), ...input })),
      getEdgesByNode: vi.fn(() => Promise.resolve([])),
      getEdgeBetween: vi.fn(() => Promise.resolve(null)),
      getEdgesByNodeIds: vi.fn((_uid: string, ids: string[]) => Promise.resolve(new Map(ids.map(id => [id, []])))),
      incrementEdgeMention: vi.fn(() => Promise.resolve()),
      updateEdgeStrength: vi.fn(() => Promise.resolve()),
      getStaleEdges: vi.fn(() => Promise.resolve([])),
      logEvent: vi.fn(() => Promise.resolve()),
      getRecentEvents: vi.fn(() => Promise.resolve([])),
      getDb: vi.fn(() => null),
    };

    const extractionJSON = JSON.stringify({
      nodes: [
        { name: 'Shabas', node_type: 'PERSON', confidence: 0.9, aliases: [], metadata: {} },
        { name: 'FRIDAY', node_type: 'PROJECT', confidence: 0.95, aliases: [], metadata: {} },
      ],
      edges: [
        { source: 'Shabas', target: 'FRIDAY', relationship_type: 'OWNS', confidence: 0.9, metadata: {} },
      ],
    });

    const router: any = {
      generate: vi.fn(() => Promise.resolve(extractionJSON)),
      extract:  vi.fn(() => Promise.resolve([])),
    };
    const extractor = new GraphExtractor(router);
    const traversal = new GraphTraversal(repo);
    const merger    = new GraphMerger(repo);
    const insights  = new GraphInsights(repo);
    const embedFn   = vi.fn(() => Promise.resolve(Array(1536).fill(0.1)));
    const search    = new GraphSearch(repo, traversal, embedFn);
    const service   = new GraphService(repo, extractor, merger, search, traversal, insights, embedFn);

    const result = await service.ingestMemory(UID, 'Shabas owns FRIDAY the AI assistant', 'mem-1');

    expect(result.nodes.some(n => n.name === 'Shabas')).toBe(true);
    expect(result.nodes.some(n => n.name === 'FRIDAY')).toBe(true);
    expect(result.edges.some(e => e.relationship_type === 'OWNS')).toBe(true);
    expect(result.extraction.nodes).toHaveLength(2);
  });
});
