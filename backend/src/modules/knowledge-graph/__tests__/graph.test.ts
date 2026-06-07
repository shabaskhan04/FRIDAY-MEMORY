// ============================================================
// graph.test.ts — Test suite for Friday Knowledge Graph Engine
// Uses Vitest. Run: npx vitest run graph.test.ts
// All tests operate on in-memory mocks — no DB required.
// ============================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getEdgeRecencyMultiplier,
  calculateGraphScore,
  decayEdgeStrength,
  boostEdgeStrength,
  nodeRecencyScore,
} from '../graph.scoring';
import { resolveQuery } from '../graph.query-resolver';
import { GraphMerger }   from '../graph.merger';
import { GraphSearch }   from '../graph.search';
import { GraphTraversal } from '../graph.traversal';
import { GraphInsights }  from '../graph.insights';
import type { GraphNode, GraphEdge } from '../graph.types';

// ============================================================
// Shared test fixtures
// ============================================================

const NOW = new Date('2026-06-06T14:00:00Z');
const DAY  = 86_400_000;

function makeNode(overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    id:                'node-1',
    user_id:           'user-1',
    node_type:         'PROJECT',
    name:              'Orin',
    description:       null,
    aliases:           [],
    metadata:          {},
    importance_score:  0.7,
    confidence_score:  1.0,
    mention_count:     5,
    last_mentioned_at: new Date(NOW.getTime() - 5 * DAY).toISOString(),
    embedding:         null,
    source_memory_ids: [],
    source_count:      1,
    canonical_id:      null,
    is_archived:       false,
    is_locked:         false,
    created_at:        new Date(NOW.getTime() - 30 * DAY).toISOString(),
    updated_at:        new Date(NOW.getTime() - 5 * DAY).toISOString(),
    ...overrides,
  };
}

function makeEdge(overrides: Partial<GraphEdge> = {}): GraphEdge {
  return {
    id:                'edge-1',
    user_id:           'user-1',
    source_node_id:    'node-1',
    target_node_id:    'node-2',
    relationship_type: 'WORKS_ON',
    strength:          0.8,
    confidence:        1.0,
    mention_count:     3,
    last_seen_at:      new Date(NOW.getTime() - 10 * DAY).toISOString(),
    metadata:          {},
    source_memory_ids: [],
    source_count:      1,
    is_pinned:         false,
    is_archived:       false,
    created_at:        new Date(NOW.getTime() - 30 * DAY).toISOString(),
    updated_at:        new Date(NOW.getTime() - 10 * DAY).toISOString(),
    ...overrides,
  };
}

// ============================================================
// 1. Edge Decay (T1 — flat recency model)
// ============================================================

describe('Edge recency multiplier (flat model)', () => {
  it('returns 1.0 for pinned edges regardless of age', () => {
    expect(getEdgeRecencyMultiplier(200, true)).toBe(1.0);
    expect(getEdgeRecencyMultiplier(0,   true)).toBe(1.0);
  });

  it('returns 1.0 for edges updated within 30 days', () => {
    expect(getEdgeRecencyMultiplier(0,  false)).toBe(1.0);
    expect(getEdgeRecencyMultiplier(15, false)).toBe(1.0);
    expect(getEdgeRecencyMultiplier(30, false)).toBe(1.0);
  });

  it('returns 0.9 for edges older than 30 days', () => {
    expect(getEdgeRecencyMultiplier(31,  false)).toBe(0.9);
    expect(getEdgeRecencyMultiplier(90,  false)).toBe(0.9);
    expect(getEdgeRecencyMultiplier(365, false)).toBe(0.9);
  });

  it('decayEdgeStrength on unpinned old edge floors at 0.05', () => {
    const edge = makeEdge({
      strength:   0.05,
      is_pinned:  false,
      last_seen_at: new Date(NOW.getTime() - 60 * DAY).toISOString(),
    });
    vi.setSystemTime(NOW);
    const result = decayEdgeStrength(edge);
    expect(result).toBeCloseTo(0.05); // floor
    vi.useRealTimers();
  });

  it('decayEdgeStrength on pinned edge does NOT decay', () => {
    const edge = makeEdge({
      strength:   0.8,
      is_pinned:  true,
      last_seen_at: new Date(NOW.getTime() - 180 * DAY).toISOString(),
    });
    vi.setSystemTime(NOW);
    expect(decayEdgeStrength(edge)).toBe(0.8); // strength × 1.0
    vi.useRealTimers();
  });
});

// ============================================================
// 2. Graph Scoring (T2)
// ============================================================

describe('calculateGraphScore', () => {
  it('clamps result to [0, 1]', () => {
    const score = calculateGraphScore({
      importanceScore:     1.0,
      edgeStrength:        1.0,
      degree:              50,
      daysSinceLastUpdate: 0,
    });
    expect(score).toBeLessThanOrEqual(1.0);
    expect(score).toBeGreaterThanOrEqual(0);
  });

  it('computes correct weighted sum for known inputs', () => {
    // importanceScore=0.8, edgeStrength=0.6, degree=25(→0.5), days=10(→multiplier=1.0)
    // = 0.8*0.4 + 0.6*0.3 + 0.5*0.2 + 1.0*0.1
    // = 0.32 + 0.18 + 0.10 + 0.10 = 0.70
    const score = calculateGraphScore({
      importanceScore:     0.8,
      edgeStrength:        0.6,
      degree:              25,
      daysSinceLastUpdate: 10,
    });
    expect(score).toBeCloseTo(0.70, 2);
  });

  it('penalizes stale unpinned edges via recency multiplier', () => {
    const fresh = calculateGraphScore({ importanceScore: 0.5, edgeStrength: 0.5, degree: 10, daysSinceLastUpdate: 5 });
    const stale = calculateGraphScore({ importanceScore: 0.5, edgeStrength: 0.5, degree: 10, daysSinceLastUpdate: 60 });
    // stale score should be 0.1*(0.9-1.0) = -0.01 lower
    expect(fresh - stale).toBeCloseTo(0.01, 5);
  });

  it('pinned edges always get recency multiplier 1.0', () => {
    const pinned   = calculateGraphScore({ importanceScore: 0.5, edgeStrength: 0.5, degree: 10, daysSinceLastUpdate: 365, isPinned: true });
    const unpinned = calculateGraphScore({ importanceScore: 0.5, edgeStrength: 0.5, degree: 10, daysSinceLastUpdate: 365, isPinned: false });
    expect(pinned).toBeGreaterThan(unpinned);
  });
});

// ============================================================
// 3. Query Resolver (T3)
// ============================================================

describe('resolveQuery', () => {
  it('classifies person questions', () => {
    const r = resolveQuery('What have I discussed with Nidha?');
    expect(r.queryType).toBe('PERSON_SEARCH');
    expect(r.entities).toContain('Nidha');
    expect(r.confidence).toBeGreaterThan(0.7);
  });

  it('classifies project questions', () => {
    const r = resolveQuery('What is connected to Orin?');
    expect(r.queryType).toBe('PROJECT_SEARCH');
    expect(r.entities).toContain('Orin');
  });

  it('classifies goal questions', () => {
    const r = resolveQuery('What projects support my fitness goal?');
    expect(r.queryType).toBe('GOAL_SEARCH');
    expect(r.confidence).toBeGreaterThan(0.7);
  });

  it('classifies relationship questions', () => {
    const r = resolveQuery('What is the relationship between Orin and scholarships?');
    expect(r.queryType).toBe('RELATIONSHIP_SEARCH');
    expect(r.entities.length).toBeGreaterThanOrEqual(2);
  });

  it('falls back to ENTITY_SEARCH for ambiguous input', () => {
    const r = resolveQuery('show me everything');
    expect(r.queryType).toBe('ENTITY_SEARCH');
    expect(r.confidence).toBeLessThan(0.7);
  });
});

// ============================================================
// 4. Duplicate Detection (T4 — merger)
// ============================================================

describe('GraphMerger — duplicate detection', () => {
  function makeRepo(nodes: GraphNode[]) {
    return {
      findNodesByName:     vi.fn((_uid: string, name: string) =>
        Promise.resolve(nodes.filter(n => n.name.toLowerCase() === name.toLowerCase()))),
      fuzzyFindNodes:      vi.fn(() => Promise.resolve(nodes)),
      findNodesByAlias:    vi.fn(() => Promise.resolve([])),
      semanticSearchNodes: vi.fn(() => Promise.resolve([])),
      getNodeById:         vi.fn((id: string) => Promise.resolve(nodes.find(n => n.id === id) ?? null)),
      updateNode:          vi.fn((_id: string, _uid: string, patch: any) =>
        Promise.resolve({ ...nodes[0], ...patch })),
      getEdgesByNode:      vi.fn(() => Promise.resolve([])),
      upsertEdge:          vi.fn(() => Promise.resolve(makeEdge())),
      logEvent:            vi.fn(() => Promise.resolve()),
    } as any;
  }

  it('detects exact match on case-insensitive name', async () => {
    const existing = makeNode({ id: 'node-existing', name: 'Orin' });
    const merger   = new GraphMerger(makeRepo([existing]));

    const candidates = await merger.findDuplicateCandidates('user-1', { name: 'orin', node_type: 'PROJECT' });
    expect(candidates[0].match_type).toBe('exact');
    expect(candidates[0].similarity).toBe(1.0);
  });

  it('decideMerge returns null when no strong candidates', () => {
    const merger = new GraphMerger({} as any);
    const result = merger.decideMerge('keep-id', [
      { node: makeNode(), match_type: 'normalized', similarity: 0.7 },
    ]);
    expect(result).toBeNull();
  });

  it('decideMerge returns decision for similarity >= 0.95', () => {
    const merger = new GraphMerger({} as any);
    const result = merger.decideMerge('keep-id', [
      { node: makeNode({ id: 'dupe-1' }), match_type: 'exact', similarity: 1.0 },
    ]);
    expect(result?.auto_approved).toBe(true);
    expect(result?.merge_ids).toContain('dupe-1');
  });
});

// ============================================================
// 5. Locked Node Protection (T9)
// ============================================================

describe('GraphMerger — locked node protection', () => {
  it('throws when keep_node is locked', async () => {
    const locked = makeNode({ id: 'locked-1', is_locked: true, name: 'Orin' });
    const repo   = {
      getNodeById: vi.fn(() => Promise.resolve(locked)),
      logEvent:    vi.fn(),
    } as any;

    const merger = new GraphMerger(repo);
    await expect(
      merger.mergeNodes('user-1', { keep_id: 'locked-1', merge_ids: ['other-1'], auto_approved: true, confidence: 1.0 }),
    ).rejects.toThrow(/locked/);
  });

  it('throws when a dupe node is locked', async () => {
    const keep   = makeNode({ id: 'keep-1',  is_locked: false, name: 'Orin' });
    const locked = makeNode({ id: 'locked-2', is_locked: true,  name: 'Orin Platform' });

    const repo = {
      getNodeById: vi.fn((id: string) =>
        Promise.resolve(id === 'keep-1' ? keep : locked)),
      logEvent: vi.fn(),
    } as any;

    const merger = new GraphMerger(repo);
    await expect(
      merger.mergeNodes('user-1', { keep_id: 'keep-1', merge_ids: ['locked-2'], auto_approved: true, confidence: 1.0 }),
    ).rejects.toThrow(/locked/);
  });

  it('decideMerge excludes locked candidates from auto-approve', () => {
    const merger = new GraphMerger({} as any);
    const result = merger.decideMerge('keep-id', [
      { node: makeNode({ id: 'locked-3', is_locked: true }), match_type: 'exact', similarity: 1.0 },
    ]);
    expect(result).toBeNull(); // locked node filtered out
  });
});

// ============================================================
// 6. Relationship Path Finding (T5)
// ============================================================

describe('GraphTraversal.findRelationshipPath', () => {
  function makeTraversalRepo(edges: GraphEdge[]) {
    return {
      getNodeById:    vi.fn((id: string) => Promise.resolve(makeNode({ id, name: id }))),
      getEdgesByNode: vi.fn((_uid: string, nodeId: string) =>
        Promise.resolve(edges.filter(e => e.source_node_id === nodeId || e.target_node_id === nodeId))),
    } as any;
  }

  it('finds direct 1-hop path', async () => {
    const edge = makeEdge({ source_node_id: 'A', target_node_id: 'B', relationship_type: 'WORKS_ON', strength: 0.8 });
    const traversal = new GraphTraversal(makeTraversalRepo([edge]));

    const result = await traversal.findRelationshipPath('user-1', 'A', 'B');
    expect(result).not.toBeNull();
    expect(result!.path).toEqual(['A', 'B']);
    expect(result!.edgeTypes).toContain('WORKS_ON');
    expect(result!.hopCount).toBe(1);
    expect(result!.totalStrength).toBeCloseTo(0.8);
  });

  it('finds 2-hop path through intermediate node', async () => {
    const edges = [
      makeEdge({ id: 'e1', source_node_id: 'A', target_node_id: 'M', relationship_type: 'RELATED_TO', strength: 0.7 }),
      makeEdge({ id: 'e2', source_node_id: 'M', target_node_id: 'B', relationship_type: 'PART_OF', strength: 0.6 }),
    ];
    const traversal = new GraphTraversal(makeTraversalRepo(edges));

    const result = await traversal.findRelationshipPath('user-1', 'A', 'B');
    expect(result).not.toBeNull();
    expect(result!.hopCount).toBe(2);
    expect(result!.path).toEqual(['A', 'M', 'B']);
    expect(result!.totalStrength).toBeCloseTo(0.65, 1); // (0.7+0.6)/2
  });

  it('returns null when no path within maxDepth', async () => {
    const traversal = new GraphTraversal(makeTraversalRepo([]));
    const result    = await traversal.findRelationshipPath('user-1', 'A', 'Z', 4);
    expect(result).toBeNull();
  });

  it('returns trivial result for same node', async () => {
    const traversal = new GraphTraversal(makeTraversalRepo([]));
    const result    = await traversal.findRelationshipPath('user-1', 'A', 'A');
    expect(result!.path).toEqual(['A']);
    expect(result!.hopCount).toBe(0);
  });
});

// ============================================================
// 7. Importance Ranking (T6)
// ============================================================

describe('getMostImportantNodes ranking', () => {
  it('scores and sorts nodes by calculateGraphScore', async () => {
    const highNode  = makeNode({ id: 'high',  importance_score: 0.9, mention_count: 20 });
    const lowNode   = makeNode({ id: 'low',   importance_score: 0.2, mention_count: 2  });

    const repo = {
      getMostImportantNodes: vi.fn(() => Promise.resolve([highNode, lowNode])),
      getNodesByType:        vi.fn(() => Promise.resolve([highNode, lowNode])),
      getEdgesByNode:        vi.fn(() => Promise.resolve([])),
    } as any;

    const search = new GraphSearch(repo, {} as any, async () => []);
    const results = await search.getMostImportantNodes('user-1', { limit: 10 });

    expect(results[0].node.id).toBe('high');
    expect(results[1].node.id).toBe('low');
    expect(results[0].score).toBeGreaterThan(results[1].score);
  });

  it('filters by node_type when specified', async () => {
    const personNode  = makeNode({ id: 'p1', node_type: 'PERSON',  name: 'Nidha' });
    const projectNode = makeNode({ id: 'pr1', node_type: 'PROJECT', name: 'Orin' });

    const repo = {
      getNodesByType:        vi.fn(() => Promise.resolve([personNode])),
      getMostImportantNodes: vi.fn(() => Promise.resolve([personNode, projectNode])),
      getEdgesByNode:        vi.fn(() => Promise.resolve([])),
    } as any;

    const search = new GraphSearch(repo, {} as any, async () => []);
    await search.getMostImportantNodes('user-1', { nodeType: 'PERSON', limit: 10 });

    expect(repo.getNodesByType).toHaveBeenCalledWith('user-1', 'PERSON', expect.any(Number));
  });
});

// ============================================================
// 8. Insight Generation (T7)
// ============================================================

describe('GraphInsights', () => {
  function makeInsightRepo(overrides: Partial<Record<string, any>> = {}) {
    return {
      getMostImportantNodes: vi.fn(() => Promise.resolve([])),
      getRecentNodes:        vi.fn(() => Promise.resolve([])),
      getNodesByType:        vi.fn(() => Promise.resolve([])),
      getNodeById:           vi.fn(() => Promise.resolve(null)),
      getEdgesByNode:        vi.fn(() => Promise.resolve([])),
      getLatestSnapshot:     vi.fn(() => Promise.resolve(null)),
      ...overrides,
    } as any;
  }

  it('getNeglectedGoals returns insight for goals older than 14 days', async () => {
    const staleGoal = makeNode({
      id:                'goal-1',
      node_type:         'GOAL',
      name:              '13% Body Fat',
      last_mentioned_at: new Date(NOW.getTime() - 20 * DAY).toISOString(),
    });

    vi.setSystemTime(NOW);
    const repo     = makeInsightRepo({ getNodesByType: vi.fn(() => Promise.resolve([staleGoal])) });
    const insights = new GraphInsights(repo);
    const result   = await insights.getNeglectedGoals('user-1');

    expect(result.length).toBeGreaterThan(0);
    expect(result[0].type).toBe('NEGLECTED_GOAL');
    expect(result[0].entity_ids).toContain('goal-1');
    vi.useRealTimers();
  });

  it('getDisconnectedProjects returns insight for isolated projects', async () => {
    const isolated = makeNode({ id: 'proj-1', node_type: 'PROJECT', name: 'Static' });
    const repo     = makeInsightRepo({
      getNodesByType: vi.fn(() => Promise.resolve([isolated])),
      getEdgesByNode: vi.fn(() => Promise.resolve([])),
    });

    const insights = new GraphInsights(repo);
    const result   = await insights.getDisconnectedProjects('user-1');

    expect(result.length).toBeGreaterThan(0);
    expect(result[0].type).toBe('DISCONNECTED_PROJECT');
    expect(result[0].entity_ids).toContain('proj-1');
  });

  it('getGrowingProjects identifies high mention-rate projects', async () => {
    const active = makeNode({
      id:           'proj-active',
      node_type:    'PROJECT',
      name:         'Orin',
      mention_count: 30,
      created_at:   new Date(NOW.getTime() - 10 * DAY).toISOString(),  // 30 mentions in 10 days
    });
    const inactive = makeNode({
      id:           'proj-quiet',
      node_type:    'PROJECT',
      name:         'Khan Designs',
      mention_count: 1,
      created_at:   new Date(NOW.getTime() - 60 * DAY).toISOString(),
    });

    vi.setSystemTime(NOW);
    const repo     = makeInsightRepo({ getNodesByType: vi.fn(() => Promise.resolve([active, inactive])) });
    const insights = new GraphInsights(repo);
    const result   = await insights.getGrowingProjects('user-1');

    expect(result[0].entity_ids).toContain('proj-active');
    vi.useRealTimers();
  });

  it('generateInsights aggregates all engines without errors', async () => {
    const insights = new GraphInsights(makeInsightRepo());
    const result   = await insights.generateInsights('user-1');
    expect(Array.isArray(result)).toBe(true);
  });
});
