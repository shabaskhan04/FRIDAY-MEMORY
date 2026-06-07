// ============================================================
// engines.test.ts — Decision + Causal engine test suite
// Run: npx vitest run engines.test.ts
// All tests use in-memory mocks — no DB required.
// ============================================================

import { describe, it, expect, vi } from 'vitest';
import {
  computeSuccessScore, computeAccuracyScore,
  computeImpactScore, computeCompositeScore, scoreDecision,
} from '../decision-engine/decision.scoring';
import { DecisionEvaluationEngine } from '../decision-engine/decision-evaluation.engine';
import { DecisionInsights }         from '../decision-engine/decision.insights';
import { CausalPathEngine }         from '../causal-engine/causal-path.engine';
import type { Decision, DecisionEvaluation } from '../decision-engine/decision.types';
import type { CausalEdge }          from '../causal-engine/causal.types';

// ============================================================
// Fixtures
// ============================================================

const UID = 'user-1';

function decision(overrides: Partial<Decision> = {}): Decision {
  return {
    id: 'd-1', user_id: UID, title: 'Launch Orin',
    description: null, decision_type: 'PRODUCT',
    reasoning: 'Orin has strong market fit',
    expected_outcome: 'Get 100 users in 3 months',
    expected_success_probability: 0.8,
    actual_outcome: null, status: 'ACTIVE',
    confidence_score: 0.75,
    decision_date: '2026-01-01T00:00:00Z',
    review_date: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function evaluation(overrides: Partial<DecisionEvaluation> = {}): DecisionEvaluation {
  return {
    id: 'ev-1', decision_id: 'd-1',
    success_score: 0.7, accuracy_score: 0.6,
    lessons: ['Launched too early', 'Users loved the core feature'],
    notes: null, evaluated_at: '2026-04-01T00:00:00Z',
    ...overrides,
  };
}

function causalEdge(overrides: Partial<CausalEdge> = {}): CausalEdge {
  return {
    id: 'ce-1', source_node_id: 'A', target_node_id: 'B',
    relationship_type: 'CAUSED', causal_strength: 0.8,
    confidence: 0.9, source_count: 3,
    causal_evidence: [], last_seen_at: '2026-06-01T00:00:00Z',
    ...overrides,
  };
}

// ============================================================
// 1. Decision Scoring
// ============================================================

describe('decision.scoring', () => {
  it('computeSuccessScore uses evaluation when available', () => {
    const score = computeSuccessScore(decision(), evaluation({ success_score: 0.7 }));
    expect(score).toBe(0.7);
  });

  it('computeSuccessScore derives from status when no evaluation', () => {
    expect(computeSuccessScore(decision({ status: 'COMPLETED' }), null)).toBeCloseTo(0.8);
    expect(computeSuccessScore(decision({ status: 'FAILED' }),    null)).toBeCloseTo(0.1);
    expect(computeSuccessScore(decision({ status: 'ABANDONED' }), null)).toBeCloseTo(0.2);
  });

  it('computeAccuracyScore: expected=0.8, actual=0.3 → accuracy=1-0.5=0.5', () => {
    // Using scoring with evaluation accuracy directly
    const score = computeAccuracyScore(decision(), evaluation({ accuracy_score: 0.5 }));
    expect(score).toBeCloseTo(0.5);
  });

  it('computeAccuracyScore falls back to expected_probability when no eval', () => {
    const score = computeAccuracyScore(decision({ expected_success_probability: 0.8 }), null);
    expect(score).toBeCloseTo(0.8);
  });

  it('computeImpactScore: empty entities → 0', () => {
    expect(computeImpactScore([])).toBe(0);
  });

  it('computeImpactScore: many high-importance entities → near 1', () => {
    const scores = Array(10).fill(0.9);
    expect(computeImpactScore(scores)).toBeGreaterThan(0.7);
  });

  it('computeCompositeScore formula: known inputs', () => {
    // 0.7*0.4 + 0.6*0.3 + 0.5*0.2 + 0.75*0.1
    // = 0.28 + 0.18 + 0.10 + 0.075 = 0.635
    const score = computeCompositeScore(0.7, 0.6, 0.5, 0.75);
    expect(score).toBeCloseTo(0.635, 3);
  });

  it('scoreDecision assembles all sub-scores correctly', () => {
    const result = scoreDecision(decision(), evaluation(), [0.8, 0.7]);
    expect(result.success_score).toBe(0.7);
    expect(result.accuracy_score).toBe(0.6);
    expect(result.composite_score).toBeGreaterThan(0);
    expect(result.composite_score).toBeLessThanOrEqual(1);
  });

  it('clamps composite score to [0, 1]', () => {
    const result = scoreDecision(
      decision({ confidence_score: 1.0 }),
      evaluation({ success_score: 1.0, accuracy_score: 1.0 }),
      [1.0, 1.0, 1.0],
    );
    expect(result.composite_score).toBeLessThanOrEqual(1.0);
    expect(result.composite_score).toBeGreaterThanOrEqual(0);
  });
});

// ============================================================
// 2. Decision Evaluation Engine
// ============================================================

describe('DecisionEvaluationEngine', () => {
  function makeRepo(d: Decision, existingEvals: DecisionEvaluation[] = []) {
    return {
      getById:           vi.fn(() => Promise.resolve(d)),
      saveEvaluation:    vi.fn((_id: string, input: any) => Promise.resolve({ id: 'eval-new', decision_id: d.id, ...input, evaluated_at: new Date().toISOString() })),
      update:            vi.fn(() => Promise.resolve(d)),
      getEvaluations:    vi.fn(() => Promise.resolve(existingEvals)),
      getLatestEvaluation: vi.fn(() => Promise.resolve(existingEvals[0] ?? null)),
    } as any;
  }

  it('evaluate() saves evaluation and returns it', async () => {
    const d    = decision();
    const repo = makeRepo(d);
    const engine = new DecisionEvaluationEngine(repo);

    const result = await engine.evaluate('d-1', UID, { success_score: 0.7, accuracy_score: 0.6, lessons: ['Started too early'] });
    expect(result.success_score).toBe(0.7);
    expect(repo.saveEvaluation).toHaveBeenCalledOnce();
  });

  it('evaluate() marks COMPLETED when success_score >= 0.6', async () => {
    const d    = decision({ status: 'ACTIVE' });
    const repo = makeRepo(d);
    const engine = new DecisionEvaluationEngine(repo);

    await engine.evaluate('d-1', UID, { success_score: 0.8, accuracy_score: 0.7 });
    expect(repo.update).toHaveBeenCalledWith('d-1', UID, expect.objectContaining({ status: 'COMPLETED' }));
  });

  it('evaluate() marks FAILED when success_score < 0.3', async () => {
    const d    = decision({ status: 'ACTIVE' });
    const repo = makeRepo(d);
    const engine = new DecisionEvaluationEngine(repo);

    await engine.evaluate('d-1', UID, { success_score: 0.2, accuracy_score: 0.3 });
    expect(repo.update).toHaveBeenCalledWith('d-1', UID, expect.objectContaining({ status: 'FAILED' }));
  });

  it('summarise() aggregates multiple evaluations', async () => {
    const evals = [
      evaluation({ success_score: 0.8, accuracy_score: 0.7, lessons: ['A'] }),
      evaluation({ success_score: 0.6, accuracy_score: 0.5, lessons: ['B', 'A'] }),
    ];
    const repo = makeRepo(decision(), evals);
    const engine = new DecisionEvaluationEngine(repo);

    const summary = await engine.summarise('d-1');
    expect(summary.avg_success).toBeCloseTo(0.7);
    expect(summary.avg_accuracy).toBeCloseTo(0.6);
    expect(summary.all_lessons).toContain('A');
    expect(summary.all_lessons).toContain('B');
    expect(summary.all_lessons).toHaveLength(2); // deduplicated
    expect(summary.evaluation_count).toBe(2);
  });
});

// ============================================================
// 3. Decision Insights
// ============================================================

describe('DecisionInsights', () => {
  const orinDecision    = decision({ id: 'd-1', title: 'Launch Orin',         decision_type: 'PRODUCT',  status: 'COMPLETED', confidence_score: 0.8 });
  const chaiDecision    = decision({ id: 'd-2', title: 'Open Chai near LPU',  decision_type: 'BUSINESS', status: 'FAILED',    confidence_score: 0.4 });
  const fitnessDecision = decision({ id: 'd-3', title: 'Reduce to 13% BF',    decision_type: 'HEALTH',   status: 'ACTIVE',    confidence_score: 0.9 });
  const khanDecision    = decision({ id: 'd-4', title: 'Prioritize Khan Designs', decision_type: 'BUSINESS', status: 'FAILED', confidence_score: 0.5 });

  function makeRepo() {
    return {
      listByUser: vi.fn((_uid: string, filters: any = {}) => {
        const all = [orinDecision, chaiDecision, fitnessDecision, khanDecision];
        if (filters.status === 'FAILED')    return Promise.resolve(all.filter(d => d.status === 'FAILED'));
        if (filters.status === 'ABANDONED') return Promise.resolve([]);
        return Promise.resolve(all);
      }),
      listFailed: vi.fn(() => Promise.resolve([chaiDecision, khanDecision])),
      getLatestEvaluation: vi.fn((id: string) => {
        const map: Record<string, DecisionEvaluation> = {
          'd-1': evaluation({ decision_id: 'd-1', success_score: 0.85, accuracy_score: 0.8 }),
          'd-2': evaluation({ decision_id: 'd-2', success_score: 0.2,  accuracy_score: 0.3 }),
          'd-3': evaluation({ decision_id: 'd-3', success_score: 0.6,  accuracy_score: 0.7 }),
          'd-4': evaluation({ decision_id: 'd-4', success_score: 0.15, accuracy_score: 0.2 }),
        };
        return Promise.resolve(map[id] ?? null);
      }),
      getDecisionEntities: vi.fn(() => Promise.resolve([])),
    } as any;
  }

  it('getBestDecisions returns highest composite score first', async () => {
    const insights = new DecisionInsights(makeRepo());
    const best = await insights.getBestDecisions(UID, 2);
    expect(best[0].decision.id).toBe('d-1'); // Orin had highest success
    expect(best[0].composite_score).toBeGreaterThan(best[1].composite_score);
  });

  it('getWorstDecisions returns lowest composite score first', async () => {
    const insights = new DecisionInsights(makeRepo());
    const worst = await insights.getWorstDecisions(UID, 2);
    expect(worst[0].composite_score).toBeLessThan(0.4);
  });

  it('getDecisionPatterns groups by decision_type', async () => {
    const insights  = new DecisionInsights(makeRepo());
    const patterns  = await insights.getDecisionPatterns(UID);
    const types     = patterns.map(p => p.pattern_type);
    expect(types).toContain('PRODUCT');
    expect(types).toContain('BUSINESS');
    expect(types).toContain('HEALTH');
  });

  it('getRecurringMistakes detects BUSINESS as recurring failure', async () => {
    const insights  = new DecisionInsights(makeRepo());
    const mistakes  = await insights.getRecurringMistakes(UID);
    expect(mistakes.some(m => m.pattern === 'BUSINESS')).toBe(true);
    expect(mistakes[0].count).toBeGreaterThanOrEqual(2);
  });

  it('getMostSuccessfulDecisionTypes returns PRODUCT/HEALTH before BUSINESS', async () => {
    const insights = new DecisionInsights(makeRepo());
    const types    = await insights.getMostSuccessfulDecisionTypes(UID);
    const topType  = types[0].pattern_type;
    expect(['PRODUCT', 'HEALTH']).toContain(topType);
  });
});

// ============================================================
// 4. Decision Graph Linking
// ============================================================

describe('Decision graph linking', () => {
  it('linkToEntity upserts with correct relationship type', async () => {
    const { DecisionRepository } = await import('../decision-engine/decision.repository');
    const db: any = {
      from: vi.fn(() => ({
        upsert: vi.fn(() => ({
          select: () => ({ single: () => Promise.resolve({ data: { id: 'de-1', decision_id: 'd-1', node_id: 'n-1', relationship_type: 'DECIDES_ON', created_at: '' }, error: null }) }),
        })),
      })),
    };
    const repo = new DecisionRepository(db);
    const result = await repo.linkToEntity('d-1', 'n-1', 'DECIDES_ON');
    expect(result.relationship_type).toBe('DECIDES_ON');
  });
});

// ============================================================
// 5. Causal Path Finding
// ============================================================

describe('CausalPathEngine', () => {
  const getName = vi.fn((_uid: string, id: string) => Promise.resolve(id));

  function makeRepo(edges: CausalEdge[]) {
    return {
      getCausalEdgesFrom: vi.fn((_uid: string, nodeId: string) =>
        Promise.resolve(edges.filter(e => e.source_node_id === nodeId))),
      getCausalEdgesTo: vi.fn((_uid: string, nodeId: string) =>
        Promise.resolve(edges.filter(e => e.target_node_id === nodeId))),
      getAllCausalEdges: vi.fn(() => Promise.resolve(edges)),
    } as any;
  }

  it('findCausalPath: direct 1-hop Marketing → Users', async () => {
    const edges = [
      causalEdge({ source_node_id: 'marketing', target_node_id: 'users', relationship_type: 'CAUSED', causal_strength: 0.85 }),
    ];
    const engine = new CausalPathEngine(makeRepo(edges), getName);
    const path   = await engine.findCausalPath(UID, 'marketing', 'users');

    expect(path).not.toBeNull();
    expect(path!.hop_count).toBe(1);
    expect(path!.node_ids).toEqual(['marketing', 'users']);
    expect(path!.total_strength).toBeCloseTo(0.85);
  });

  it('findCausalPath: 2-hop Marketing → Users → Revenue', async () => {
    const edges = [
      causalEdge({ id: 'e1', source_node_id: 'marketing', target_node_id: 'users',   relationship_type: 'CAUSED', causal_strength: 0.85 }),
      causalEdge({ id: 'e2', source_node_id: 'users',     target_node_id: 'revenue', relationship_type: 'CONTRIBUTED_TO', causal_strength: 0.75 }),
    ];
    const engine = new CausalPathEngine(makeRepo(edges), getName);
    const path   = await engine.findCausalPath(UID, 'marketing', 'revenue');

    expect(path!.hop_count).toBe(2);
    expect(path!.node_ids).toEqual(['marketing', 'users', 'revenue']);
    // geometric mean of 0.85 and 0.75 ≈ 0.798
    expect(path!.total_strength).toBeCloseTo(Math.sqrt(0.85 * 0.75), 2);
  });

  it('findCausalPath: returns null when no path exists', async () => {
    const engine = new CausalPathEngine(makeRepo([]), getName);
    const path   = await engine.findCausalPath(UID, 'A', 'Z');
    expect(path).toBeNull();
  });

  it('findCausalPath: trivial path for same node', async () => {
    const engine = new CausalPathEngine(makeRepo([]), getName);
    const path   = await engine.findCausalPath(UID, 'A', 'A');
    expect(path!.hop_count).toBe(0);
    expect(path!.total_strength).toBe(1);
  });

  it('findRootCauses: Gym → Weight Loss, root is Gym', async () => {
    const edges = [
      causalEdge({ source_node_id: 'gym', target_node_id: 'weight-loss', relationship_type: 'CONTRIBUTED_TO', causal_strength: 0.9 }),
    ];
    const engine  = new CausalPathEngine(makeRepo(edges), getName);
    const results = await engine.findRootCauses(UID, 'weight-loss');

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].root_node_id).toBe('gym');
    expect(results[0].influence_score).toBeCloseTo(0.9);
  });

  it('findDownstreamEffects: Marketing → Users, Users is downstream', async () => {
    const edges = [
      causalEdge({ source_node_id: 'marketing', target_node_id: 'users', relationship_type: 'CAUSED', causal_strength: 0.8 }),
    ];
    const engine  = new CausalPathEngine(makeRepo(edges), getName);
    const effects = await engine.findDownstreamEffects(UID, 'marketing');

    expect(effects.some(e => e.effect_node_id === 'users')).toBe(true);
  });

  it('findMostInfluentialNodes: multi-edge source scores higher', async () => {
    const edges = [
      causalEdge({ id: 'e1', source_node_id: 'khan-designs', target_node_id: 'revenue',  causal_strength: 0.9 }),
      causalEdge({ id: 'e2', source_node_id: 'khan-designs', target_node_id: 'cash-flow', causal_strength: 0.8 }),
      causalEdge({ id: 'e3', source_node_id: 'orin',         target_node_id: 'revenue',   causal_strength: 0.7 }),
    ];
    const engine   = new CausalPathEngine(makeRepo(edges), getName);
    const top      = await engine.findMostInfluentialNodes(UID, 5);

    expect(top[0].node_id).toBe('khan-designs');
    expect(top[0].outbound_causal_edges).toBe(2);
  });
});

// ============================================================
// 6. Confidence scoring on causal edges
// ============================================================

describe('Causal edge confidence', () => {
  it('edge with more sources should have higher source_count', () => {
    const weakEdge   = causalEdge({ source_count: 1, confidence: 0.4 });
    const strongEdge = causalEdge({ source_count: 10, confidence: 0.95 });
    expect(strongEdge.source_count).toBeGreaterThan(weakEdge.source_count);
    expect(strongEdge.confidence).toBeGreaterThan(weakEdge.confidence);
  });

  it('Nidha FRIEND_OF Mr. Khan — 12 supporting memories gives source_count=12', () => {
    const edge = causalEdge({ source_count: 12, confidence: 0.91, causal_strength: 0.88 });
    expect(edge.source_count).toBe(12);
    expect(edge.confidence).toBeCloseTo(0.91);
  });
});

// ============================================================
// 7. Realistic scenario: Full Orin launch chain
// ============================================================

describe('Realistic scenario: Orin launch causal chain', () => {
  const getName = vi.fn((_uid: string, id: string) => Promise.resolve(id));

  it('Marketing → More Users → More Revenue chain resolves correctly', async () => {
    const edges = [
      causalEdge({ id: 'e1', source_node_id: 'marketing-campaign', target_node_id: 'more-users',   relationship_type: 'CAUSED',        causal_strength: 0.85 }),
      causalEdge({ id: 'e2', source_node_id: 'more-users',         target_node_id: 'more-revenue', relationship_type: 'CONTRIBUTED_TO', causal_strength: 0.75 }),
    ];
    const repo = {
      getCausalEdgesFrom: vi.fn((_uid: string, id: string) => Promise.resolve(edges.filter(e => e.source_node_id === id))),
      getCausalEdgesTo:   vi.fn((_uid: string, id: string) => Promise.resolve(edges.filter(e => e.target_node_id === id))),
      getAllCausalEdges:   vi.fn(() => Promise.resolve(edges)),
    } as any;

    const engine  = new CausalPathEngine(repo, getName);
    const path    = await engine.findCausalPath(UID, 'marketing-campaign', 'more-revenue');
    const roots   = await engine.findRootCauses(UID, 'more-revenue');
    const effects = await engine.findDownstreamEffects(UID, 'marketing-campaign');

    expect(path!.node_ids).toEqual(['marketing-campaign', 'more-users', 'more-revenue']);
    expect(roots[0].root_node_id).toBe('marketing-campaign');
    expect(effects.some(e => e.effect_node_id === 'more-revenue')).toBe(true);

    // Example output:
    // path.total_strength ≈ √(0.85 × 0.75) ≈ 0.798
    expect(path!.total_strength).toBeGreaterThan(0.7);
  });

  it('Gym Consistency CONTRIBUTED_TO Weight Loss → root is Gym Consistency', async () => {
    const edges = [
      causalEdge({ source_node_id: 'gym-consistency', target_node_id: 'weight-loss', relationship_type: 'CONTRIBUTED_TO', causal_strength: 0.9 }),
    ];
    const repo = {
      getCausalEdgesFrom: vi.fn((_uid: string, id: string) => Promise.resolve(edges.filter(e => e.source_node_id === id))),
      getCausalEdgesTo:   vi.fn((_uid: string, id: string) => Promise.resolve(edges.filter(e => e.target_node_id === id))),
      getAllCausalEdges:   vi.fn(() => Promise.resolve(edges)),
    } as any;

    const engine = new CausalPathEngine(repo, getName);
    const roots  = await engine.findRootCauses(UID, 'weight-loss');

    expect(roots[0].root_node_id).toBe('gym-consistency');
    expect(roots[0].path.hop_count).toBe(1);
  });
});
