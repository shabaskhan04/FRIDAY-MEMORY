// ============================================================
// strategic-intelligence.test.ts
// Test suite for P1–P6 strategic intelligence layer
// Run: npx vitest run strategic-intelligence.test.ts
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CanonicalRegistry }    from '../canonical.registry';
import { SnapshotService }      from '../snapshot.service';
import { AttentionEngine }      from '../attention.engine';
import { GoalAlignmentEngine }  from '../goal-alignment.engine';
import { ContradictionEngine }  from '../contradiction.engine';
import { ConfidenceEngine }     from '../confidence.engine';
import type { GraphNode, GraphEdge, GraphSnapshot } from '../graph.types';

// ============================================================
// Shared fixtures
// ============================================================

const NOW = new Date('2026-06-06T14:00:00Z');
const DAY = 86_400_000;
const UID = 'user-1';

function node(overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    id: 'node-1', user_id: UID, node_type: 'PROJECT', name: 'Orin',
    description: null, aliases: [], metadata: {}, importance_score: 0.7,
    confidence_score: 0.9, source_count: 5, mention_count: 10,
    last_mentioned_at: new Date(NOW.getTime() - 3 * DAY).toISOString(),
    embedding: null, source_memory_ids: [], canonical_id: null,
    is_archived: false, is_locked: false,
    created_at: new Date(NOW.getTime() - 30 * DAY).toISOString(),
    updated_at: new Date(NOW.getTime() - 3 * DAY).toISOString(),
    ...overrides,
  };
}

function edge(overrides: Partial<GraphEdge> = {}): GraphEdge {
  return {
    id: 'edge-1', user_id: UID, source_node_id: 'node-1', target_node_id: 'node-2',
    relationship_type: 'WORKS_ON', strength: 0.8, confidence: 0.9,
    source_count: 3, mention_count: 5,
    last_seen_at: new Date(NOW.getTime() - 5 * DAY).toISOString(),
    metadata: {}, source_memory_ids: [], is_pinned: false, is_archived: false,
    created_at: new Date(NOW.getTime() - 30 * DAY).toISOString(),
    updated_at: new Date(NOW.getTime() - 5 * DAY).toISOString(),
    ...overrides,
  };
}

function snapshot(nodes: GraphNode[], edges: GraphEdge[], id = 'snap-1'): GraphSnapshot {
  return {
    id, user_id: UID,
    snapshot: { nodes, edges },
    node_count: nodes.length, edge_count: edges.length,
    top_entities: [], top_projects: [], top_people: [], top_goals: [],
    trigger: 'test',
    created_at: new Date(NOW.getTime() - 7 * DAY).toISOString(),
  };
}

// ============================================================
// P1 — Canonical entity registry
// ============================================================

describe('CanonicalRegistry', () => {
  function makeDb(canonicals: any[] = [], nodes: GraphNode[] = []) {
    const chain = () => {
      const q: any = {
        data: null, error: null,
        select:   function() { return this; },
        eq:       function() { return this; },
        ilike:    function() { return this; },
        contains: function() { return this; },
        order:    function() { return this; },
        maybeSingle: function() { return Promise.resolve({ data: canonicals[0] ?? null, error: null }); },
        single:   function() { return Promise.resolve({ data: canonicals[0] ?? null, error: null }); },
      };
      return q;
    };
    return {
      from: vi.fn(() => chain()),
      rpc:  vi.fn(() => Promise.resolve({ data: nodes, error: null })),
    } as any;
  }

  function makeRepo(nodes: GraphNode[] = []) {
    return {
      getNodeById:  vi.fn((id: string) => Promise.resolve(nodes.find(n => n.id === id) ?? null)),
      updateNode:   vi.fn((_id: string, _uid: string, patch: any) => Promise.resolve({ ...node(), ...patch })),
      logEvent:     vi.fn(),
    } as any;
  }

  it('resolveCanonicalEntity returns canonical by display_name', async () => {
    const canonical = { id: 'c1', canonical_id: 'PROJECT_ORIN', display_name: 'Orin', entity_type: 'PROJECT', aliases: [], user_id: UID };
    const registry  = new CanonicalRegistry(makeDb([canonical]), makeRepo());
    const result    = await registry.resolveCanonicalEntity(UID, 'Orin');
    expect(result?.canonical_id).toBe('PROJECT_ORIN');
  });

  it('assignCanonicalId throws when canonical not found and createIfMissing not provided', async () => {
    const db   = makeDb([]); // no canonical found
    const repo = makeRepo([node()]);
    // Override maybeSingle to return null
    db.from = vi.fn(() => ({
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) }),
      insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: null, error: new Error('not found') }) }) }),
    }));
    const registry = new CanonicalRegistry(db, repo);
    await expect(registry.assignCanonicalId(UID, 'node-1', 'PROJECT_ORIN')).rejects.toThrow(/not found/);
  });

  it('getCanonicalVariants calls RPC with correct canonical_id', async () => {
    const variants = [node({ id: 'n1', name: 'Orin' }), node({ id: 'n2', name: 'Orin Platform' })];
    const db       = makeDb([], variants);
    const repo     = makeRepo(variants);
    const registry = new CanonicalRegistry(db, repo);
    const result   = await registry.getCanonicalVariants(UID, 'PROJECT_ORIN');
    expect(db.rpc).toHaveBeenCalledWith('get_nodes_by_canonical', {
      p_user_id: UID, p_canonical_id: 'PROJECT_ORIN',
    });
    expect(result).toHaveLength(2);
  });
});

// ============================================================
// P2 — Snapshot comparison
// ============================================================

describe('SnapshotService.compareSnapshots', () => {
  function makeRepo(snap1: GraphSnapshot, snap2: GraphSnapshot) {
    return {
      getSnapshotById:    vi.fn((uid: string, id: string) =>
        Promise.resolve(id === snap1.id ? snap1 : snap2)),
      getMostImportantNodes: vi.fn(() => Promise.resolve([])),
      getNodesByType:     vi.fn(() => Promise.resolve([])),
      createStructuredSnapshot: vi.fn(() => Promise.resolve(snap1)),
    } as any;
  }

  it('counts added and removed nodes correctly', async () => {
    const nA = node({ id: 'A', importance_score: 0.6 });
    const nB = node({ id: 'B', importance_score: 0.6 });
    const nC = node({ id: 'C', importance_score: 0.6 });

    const from = snapshot([nA, nB], [], 'snap-from');
    const to   = snapshot([nB, nC], [], 'snap-to');  // A removed, C added

    vi.setSystemTime(NOW);
    const svc    = new SnapshotService(makeRepo(from, to));
    const result = await svc.compareSnapshots(UID, 'snap-from', 'snap-to');

    expect(result.nodes_added).toBe(1);     // C
    expect(result.nodes_removed).toBe(1);   // A
    vi.useRealTimers();
  });

  it('identifies emerging entities (new + importance > avg)', async () => {
    const old = node({ id: 'existing', importance_score: 0.3 });
    const emerging = node({ id: 'new-hot', importance_score: 0.9, name: 'Orin AI' });

    const from = snapshot([old], [], 'snap-from');
    const to   = snapshot([old, emerging], [], 'snap-to');

    const svc    = new SnapshotService(makeRepo(from, to));
    const result = await svc.compareSnapshots(UID, 'snap-from', 'snap-to');

    expect(result.emerging_entities.some(e => e.id === 'new-hot')).toBe(true);
  });

  it('identifies declining entities (importance dropped >= 0.1)', async () => {
    const nBefore = node({ id: 'declining', importance_score: 0.8 });
    const nAfter  = node({ id: 'declining', importance_score: 0.5 });  // dropped 0.3

    const from = snapshot([nBefore], [], 'snap-from');
    const to   = snapshot([nAfter],  [], 'snap-to');

    const svc    = new SnapshotService(makeRepo(from, to));
    const result = await svc.compareSnapshots(UID, 'snap-from', 'snap-to');

    expect(result.declining_entities.some(e => e.id === 'declining')).toBe(true);
  });
});

// ============================================================
// P3 — Attention engine
// ============================================================

describe('AttentionEngine.calculateAttentionScore', () => {
  const engine = new AttentionEngine({} as any);

  it('returns 0 attention for archived node with no edges', () => {
    vi.setSystemTime(NOW);
    const stale = node({ mention_count: 0, last_mentioned_at: new Date(NOW.getTime() - 60 * DAY).toISOString() });
    const result = engine.calculateAttentionScore(stale, []);
    expect(result.attention_score).toBeLessThan(0.2);
    vi.useRealTimers();
  });

  it('returns high attention for recently mentioned node with strong edges', () => {
    vi.setSystemTime(NOW);
    const active = node({
      mention_count:     40,
      last_mentioned_at: new Date(NOW.getTime() - 1 * DAY).toISOString(),
    });
    const edges = [
      edge({ strength: 0.9, last_seen_at: new Date(NOW.getTime() - 1 * DAY).toISOString() }),
      edge({ id: 'e2', strength: 0.85, last_seen_at: new Date(NOW.getTime() - 2 * DAY).toISOString() }),
    ];
    const result = engine.calculateAttentionScore(active, edges, 1);
    expect(result.attention_score).toBeGreaterThan(0.6);
    vi.useRealTimers();
  });

  it('relationship_growth is capped at 0 when no edges grown', () => {
    const result = engine.calculateAttentionScore(node(), [], 5);  // had 5, now 0
    expect(result.relationship_growth).toBe(0);
  });

  it('weights sum to 1.0 on max inputs', () => {
    vi.setSystemTime(NOW);
    const maxNode = node({
      mention_count:     100,
      last_mentioned_at: NOW.toISOString(),
    });
    const maxEdges = Array.from({ length: 10 }, (_, i) =>
      edge({ id: `e${i}`, strength: 1.0 })
    );
    const result = engine.calculateAttentionScore(maxNode, maxEdges, 5);
    expect(result.attention_score).toBeCloseTo(1.0, 1);
    vi.useRealTimers();
  });
});

describe('AttentionEngine.getAttentionDistribution', () => {
  it('groups average attention by node type', async () => {
    const projectNode = node({ id: 'p1', node_type: 'PROJECT', mention_count: 20 });
    const goalNode    = node({ id: 'g1', node_type: 'GOAL',    mention_count: 5  });

    const repo: any = {
      getMostImportantNodes: vi.fn(() => Promise.resolve([projectNode, goalNode])),
      getEdgesByNode:        vi.fn(() => Promise.resolve([])),
      getLatestSnapshot:     vi.fn(() => Promise.resolve(null)),
    };

    vi.setSystemTime(NOW);
    const engine = new AttentionEngine(repo);
    const dist   = await engine.getAttentionDistribution(UID);

    expect(dist.by_type).toHaveProperty('PROJECT');
    expect(dist.by_type).toHaveProperty('GOAL');
    expect(dist.by_type['PROJECT']).toBeGreaterThan(dist.by_type['GOAL']);
    expect(dist.total_nodes).toBe(2);
    vi.useRealTimers();
  });
});

// ============================================================
// P4 — Goal alignment engine
// ============================================================

describe('GoalAlignmentEngine', () => {
  function makeGoalRepo(goalNode: GraphNode, inboundEdges: GraphEdge[], neighborNodes: GraphNode[] = []) {
    const allNodes = [goalNode, ...neighborNodes];
    return {
      getNodeById:     vi.fn((id: string) => Promise.resolve(allNodes.find(n => n.id === id) ?? null)),
      getEdgesByNode:  vi.fn((_uid: string, _id: string, direction: string) => {
        if (direction === 'inbound') return Promise.resolve(inboundEdges);
        return Promise.resolve([]);
      }),
      getNodesByType:  vi.fn(() => Promise.resolve([goalNode])),
    } as any;
  }

  it('calculateGoalAlignment: contributors have CONTRIBUTES_TO edges', async () => {
    const goal    = node({ id: 'goal-1', node_type: 'GOAL', name: '13% Body Fat' });
    const project = node({ id: 'proj-1', node_type: 'PROJECT', name: 'Gym' });
    const contrib = edge({ id: 'e-contrib', source_node_id: 'proj-1', target_node_id: 'goal-1', relationship_type: 'CONTRIBUTES_TO', strength: 0.9 });

    const engine = new GoalAlignmentEngine(makeGoalRepo(goal, [contrib], [project]));
    const result = await engine.calculateGoalAlignment(UID, 'goal-1');

    expect(result.contributors).toHaveLength(1);
    expect(result.contributors[0].node.id).toBe('proj-1');
    expect(result.alignment_score).toBeGreaterThan(0);
    expect(result.detractors).toHaveLength(0);
  });

  it('calculateGoalAlignment: detractors reduce alignment_score', async () => {
    const goal      = node({ id: 'goal-1', node_type: 'GOAL', name: 'Revenue Goal' });
    const distract  = node({ id: 'dis-1',  node_type: 'PROJECT', name: 'Timewaster' });
    const distEdge  = edge({ id: 'e-dist', source_node_id: 'dis-1', target_node_id: 'goal-1', relationship_type: 'DISTRACTS_FROM', strength: 0.8 });

    const engine = new GoalAlignmentEngine(makeGoalRepo(goal, [distEdge], [distract]));
    const result = await engine.calculateGoalAlignment(UID, 'goal-1');

    expect(result.detractors).toHaveLength(1);
    expect(result.alignment_score).toBe(0);  // no contributors to counterbalance
  });

  it('calculateGoalAlignment: mixed contributors+detractors produces balanced score', async () => {
    const goal     = node({ id: 'goal-1', node_type: 'GOAL' });
    const contrib  = node({ id: 'c1', node_type: 'PROJECT' });
    const detr     = node({ id: 'd1', node_type: 'PROJECT' });
    const cEdge    = edge({ id: 'ec', source_node_id: 'c1', target_node_id: 'goal-1', relationship_type: 'CONTRIBUTES_TO', strength: 0.8 });
    const dEdge    = edge({ id: 'ed', source_node_id: 'd1', target_node_id: 'goal-1', relationship_type: 'DISTRACTS_FROM', strength: 0.4 });

    const engine = new GoalAlignmentEngine(makeGoalRepo(goal, [cEdge, dEdge], [contrib, detr]));
    const result = await engine.calculateGoalAlignment(UID, 'goal-1');

    // contribSum=0.8, detractSum=0.4, total=1.2 → score=(0.8-0.4)/1.2 ≈ 0.333
    expect(result.alignment_score).toBeCloseTo(0.333, 2);
  });

  it('throws when node is not a GOAL', async () => {
    const nonGoal = node({ id: 'proj-x', node_type: 'PROJECT' });
    const repo: any = { getNodeById: vi.fn(() => Promise.resolve(nonGoal)) };
    const engine    = new GoalAlignmentEngine(repo);
    await expect(engine.calculateGoalAlignment(UID, 'proj-x')).rejects.toThrow(/not a GOAL/);
  });
});

// ============================================================
// P5 — Contradiction detection
// ============================================================

describe('ContradictionEngine', () => {
  it('detectGoalReversals: detects goal created then archived', async () => {
    const createdTs  = new Date(NOW.getTime() - 60 * DAY).toISOString();
    const archivedTs = new Date(NOW.getTime() - 10 * DAY).toISOString();

    const events = [
      { id: 'ev1', user_id: UID, event_type: 'NODE_CREATED', entity_id: 'goal-1', entity_kind: 'node', payload: {}, created_at: createdTs },
      { id: 'ev2', user_id: UID, event_type: 'NODE_UPDATED', entity_id: 'goal-1', entity_kind: 'node', payload: { is_archived: true }, created_at: archivedTs },
    ];

    const repo: any = {
      getRecentEvents: vi.fn(() => Promise.resolve(events)),
      getNodeById:     vi.fn(() => Promise.resolve(node({ id: 'goal-1', node_type: 'GOAL' }))),
    };

    vi.setSystemTime(NOW);
    const engine  = new ContradictionEngine(repo);
    const results = await engine.detectGoalReversals(UID);

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].contradiction_type).toBe('GOAL_REVERSAL');
    expect(results[0].entity_ids).toContain('goal-1');
    expect(results[0].confidence).toBeGreaterThan(0.6);
    vi.useRealTimers();
  });

  it('detectGoalReversals: ignores non-GOAL nodes', async () => {
    const events = [
      { id: 'ev1', user_id: UID, event_type: 'NODE_CREATED', entity_id: 'proj-1', entity_kind: 'node', payload: {}, created_at: new Date(NOW.getTime() - 60 * DAY).toISOString() },
      { id: 'ev2', user_id: UID, event_type: 'NODE_UPDATED', entity_id: 'proj-1', entity_kind: 'node', payload: { is_archived: true }, created_at: new Date(NOW.getTime() - 10 * DAY).toISOString() },
    ];
    const repo: any = {
      getRecentEvents: vi.fn(() => Promise.resolve(events)),
      getNodeById:     vi.fn(() => Promise.resolve(node({ id: 'proj-1', node_type: 'PROJECT' }))),
    };
    const engine  = new ContradictionEngine(repo);
    const results = await engine.detectGoalReversals(UID);
    expect(results).toHaveLength(0);
  });

  it('detectRelationshipReversals: edge created then removed', async () => {
    const events = [
      { id: 'ev1', user_id: UID, event_type: 'EDGE_CREATED', entity_id: 'edge-x', entity_kind: 'edge', payload: {}, created_at: new Date(NOW.getTime() - 50 * DAY).toISOString() },
      { id: 'ev2', user_id: UID, event_type: 'EDGE_REMOVED', entity_id: 'edge-x', entity_kind: 'edge', payload: {}, created_at: new Date(NOW.getTime() - 10 * DAY).toISOString() },
    ];
    const repo: any = { getRecentEvents: vi.fn(() => Promise.resolve(events)) };
    const engine    = new ContradictionEngine(repo);
    const results   = await engine.detectRelationshipReversals(UID);

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].contradiction_type).toBe('RELATIONSHIP_REVERSAL');
  });

  it('detectPriorityReversals: detects importance drop >= 0.3', async () => {
    const highPriority = node({ id: 'n1', importance_score: 0.8 });
    const lowPriority  = node({ id: 'n1', importance_score: 0.3 }); // dropped 0.5

    const snap1 = snapshot([highPriority], [], 'snap-latest');
    snap1.created_at = new Date(NOW.getTime() - 1 * DAY).toISOString();
    const snap2 = snapshot([lowPriority],  [], 'snap-prev');
    snap2.created_at = new Date(NOW.getTime() - 8 * DAY).toISOString();

    const repo: any = {
      getSnapshots: vi.fn(() => Promise.resolve([snap1, snap2])),
    };
    const engine  = new ContradictionEngine(repo);
    const results = await engine.detectPriorityReversals(UID);

    expect(results.some(r => r.contradiction_type === 'PRIORITY_REVERSAL')).toBe(true);
  });
});

// ============================================================
// P6 — Confidence tracking
// ============================================================

describe('ConfidenceEngine.calculateNodeConfidence', () => {
  const engine = new ConfidenceEngine({} as any);

  it('returns high confidence for well-supported node', () => {
    const well = node({ source_count: 15, mention_count: 50, aliases: [] });
    const { final_confidence } = engine.calculateNodeConfidence(well, 0);
    expect(final_confidence).toBeGreaterThan(0.7);
  });

  it('returns low confidence for sparse node', () => {
    const sparse = node({ source_count: 1, mention_count: 1, aliases: [] });
    const { final_confidence } = engine.calculateNodeConfidence(sparse, 0);
    expect(final_confidence).toBeLessThan(0.4);
  });

  it('penalises nodes with many aliases (consistency)', () => {
    const fewAliases  = node({ source_count: 10, mention_count: 20, aliases: ['a', 'b'] });
    const manyAliases = node({ source_count: 10, mention_count: 20, aliases: Array(15).fill('alias') });
    const scoreA = engine.calculateNodeConfidence(fewAliases).final_confidence;
    const scoreB = engine.calculateNodeConfidence(manyAliases).final_confidence;
    expect(scoreA).toBeGreaterThan(scoreB);
  });

  it('penalises erratic update history (stability)', () => {
    const stable  = node({ source_count: 10, mention_count: 20 });
    const erratic = node({ source_count: 10, mention_count: 20 });
    const sScore  = engine.calculateNodeConfidence(stable,  0).final_confidence;
    const eScore  = engine.calculateNodeConfidence(erratic, 10).final_confidence;
    expect(sScore).toBeGreaterThan(eScore);
  });
});

describe('ConfidenceEngine.calculateEdgeConfidence', () => {
  const engine = new ConfidenceEngine({} as any);

  it('pinned edges always get stability_score = 1.0', () => {
    const pinnedEdge = edge({ is_pinned: true, source_count: 1, mention_count: 1, strength: 0.3 });
    const result     = engine.calculateEdgeConfidence(pinnedEdge);
    expect(result.stability_score).toBe(1.0);
  });

  it('high source_count + mention_count → high confidence', () => {
    const strong = edge({ source_count: 12, mention_count: 30, strength: 0.9 });
    const result = engine.calculateEdgeConfidence(strong);
    expect(result.final_confidence).toBeGreaterThan(0.65);
  });

  it('low source_count → low confidence', () => {
    const weak = edge({ source_count: 1, mention_count: 1, strength: 0.3 });
    const result = engine.calculateEdgeConfidence(weak);
    expect(result.final_confidence).toBeLessThan(0.4);
  });

  it('oscillating strength history → lower consistency', () => {
    const stable    = edge({ source_count: 8, mention_count: 10 });
    const oscillate = edge({ source_count: 8, mention_count: 10 });
    const sResult   = engine.calculateEdgeConfidence(stable,    [0.8, 0.8, 0.8, 0.8]);
    const oResult   = engine.calculateEdgeConfidence(oscillate, [0.1, 0.9, 0.1, 0.9]);
    expect(sResult.consistency_score).toBeGreaterThan(oResult.consistency_score);
  });
});

// ============================================================
// Realistic graph example — Mr. Khan's world
// ============================================================

describe('Full graph scenario: Mr. Khan AIOS', () => {
  it('attention is higher for active projects than stale ones', () => {
    vi.setSystemTime(NOW);
    const engine = new AttentionEngine({} as any);

    const orin = node({ id: 'orin', name: 'Orin', mention_count: 30, last_mentioned_at: new Date(NOW.getTime() - 1 * DAY).toISOString() });
    const staticProj = node({ id: 'static', name: 'Static', mention_count: 2, last_mentioned_at: new Date(NOW.getTime() - 25 * DAY).toISOString() });

    const orinEdges   = [edge({ id: 'e1', strength: 0.9 }), edge({ id: 'e2', strength: 0.85 })];
    const staticEdges = [edge({ id: 'e3', strength: 0.3 })];

    const orinScore   = engine.calculateAttentionScore(orin, orinEdges, 1);
    const staticScore = engine.calculateAttentionScore(staticProj, staticEdges, 2);

    expect(orinScore.attention_score).toBeGreaterThan(staticScore.attention_score);
    vi.useRealTimers();
  });

  it('goal alignment: Orin CONTRIBUTES_TO revenue goal → positive alignment', async () => {
    const revenueGoal = node({ id: 'rev-goal', node_type: 'GOAL', name: 'Revenue Goal' });
    const orin        = node({ id: 'orin', node_type: 'PROJECT', name: 'Orin' });
    const contrib     = edge({ source_node_id: 'orin', target_node_id: 'rev-goal', relationship_type: 'CONTRIBUTES_TO', strength: 0.85 });

    const repo: any = {
      getNodeById:    vi.fn((id: string) => Promise.resolve(id === 'rev-goal' ? revenueGoal : orin)),
      getEdgesByNode: vi.fn((_u: string, _id: string, dir: string) =>
        dir === 'inbound' ? Promise.resolve([contrib]) : Promise.resolve([])),
    };

    const engine = new GoalAlignmentEngine(repo);
    const result = await engine.calculateGoalAlignment(UID, 'rev-goal');

    expect(result.alignment_score).toBe(1.0); // only contributors, no detractors
    expect(result.contributors[0].node.name).toBe('Orin');
  });

  it('confidence: Nidha FRIEND_OF Mr. Khan from 12 memories → high confidence', () => {
    const engine = new ConfidenceEngine({} as any);
    const nidhaEdge = edge({
      source_count:  12,
      mention_count: 12,
      strength:      0.91,
      is_pinned:     false,
      relationship_type: 'FRIEND_OF',
    });
    const { final_confidence } = engine.calculateEdgeConfidence(nidhaEdge, [0.88, 0.9, 0.91, 0.91]);
    expect(final_confidence).toBeGreaterThan(0.7);
  });
});
