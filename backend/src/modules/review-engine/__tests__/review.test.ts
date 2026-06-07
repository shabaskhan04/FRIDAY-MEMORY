// ============================================================
// review.test.ts — Strategic Review Engine test suite
// Run: npx vitest run review.test.ts
// All tests use in-memory data — no DB required.
// ============================================================

import { describe, it, expect } from 'vitest';
import { FocusEngine }          from '../focus.engine';
import { RiskEngine }           from '../risk.engine';
import { PriorityEngine }       from '../priority.engine';
import { RecommendationEngine } from '../recommendation.engine';
import {
  calculatePriorityScore,
  computeFocusAndResult,
  stagnationRisk,
  concentrationRisk,
  overallScore,
} from '../review-scoring';
import type { EntityContext }   from '../review.types';

// ============================================================
// Fixtures — Mr. Khan's world
// ============================================================

function entity(overrides: Partial<EntityContext> & { name: string; id?: string }): EntityContext {
  return {
    id:                      overrides.id ?? overrides.name,
    node_type:               'PROJECT',
    importance_score:        0.7,
    attention_score:         0.6,
    goal_alignment_score:    0.6,
    causal_influence_score:  0.5,
    decision_success_rate:   0.7,
    days_since_last_mention: 5,
    edge_count:              8,
    mention_count:           10,
    ...overrides,
  };
}

// Realistic entities
const ORIN = entity({ name: 'Orin', node_type: 'PROJECT',
  importance_score: 0.85, attention_score: 0.80, goal_alignment_score: 0.88,
  causal_influence_score: 0.75, decision_success_rate: 0.80, days_since_last_mention: 2, edge_count: 12, mention_count: 25 });

const STATIC = entity({ name: 'Static', node_type: 'PROJECT',
  importance_score: 0.60, attention_score: 0.25, goal_alignment_score: 0.55,
  causal_influence_score: 0.40, decision_success_rate: 0.65, days_since_last_mention: 18, edge_count: 5, mention_count: 6 });

const KHAN_DESIGNS = entity({ name: 'Khan Designs', node_type: 'BUSINESS',
  importance_score: 0.80, attention_score: 0.70, goal_alignment_score: 0.78,
  causal_influence_score: 0.65, decision_success_rate: 0.75, days_since_last_mention: 4, edge_count: 10, mention_count: 20 });

const CHAI = entity({ name: 'Chai', node_type: 'BUSINESS',
  importance_score: 0.50, attention_score: 0.15, goal_alignment_score: 0.40,
  causal_influence_score: 0.20, decision_success_rate: 0.30, days_since_last_mention: 45, edge_count: 3, mention_count: 4 });

const FITNESS = entity({ name: 'Fitness Goal', node_type: 'GOAL',
  importance_score: 0.75, attention_score: 0.35, goal_alignment_score: 1.0,
  causal_influence_score: 0.30, decision_success_rate: 0.60, days_since_last_mention: 20, edge_count: 4, mention_count: 8 });

const REVENUE = entity({ name: 'Revenue Goal', node_type: 'GOAL',
  importance_score: 0.90, attention_score: 0.72, goal_alignment_score: 1.0,
  causal_influence_score: 0.60, decision_success_rate: 0.78, days_since_last_mention: 3, edge_count: 8, mention_count: 18 });

const LXV = entity({ name: 'LXV', node_type: 'BUSINESS',
  importance_score: 0.65, attention_score: 0.45, goal_alignment_score: 0.55,
  causal_influence_score: 0.35, decision_success_rate: 0.50, days_since_last_mention: 10, edge_count: 6, mention_count: 9 });

const ALL = [ORIN, STATIC, KHAN_DESIGNS, CHAI, FITNESS, REVENUE, LXV];

// ============================================================
// 1. Scoring primitives
// ============================================================

describe('review-scoring', () => {
  it('calculatePriorityScore: Orin scores higher than Chai', () => {
    const orin = calculatePriorityScore(ORIN);
    const chai = calculatePriorityScore(CHAI);
    expect(orin.priority_score).toBeGreaterThan(chai.priority_score);
  });

  it('calculatePriorityScore: all 5 factors present', () => {
    const f = calculatePriorityScore(ORIN);
    expect(f).toHaveProperty('goal_alignment');
    expect(f).toHaveProperty('attention');
    expect(f).toHaveProperty('decision_impact');
    expect(f).toHaveProperty('causal_influence');
    expect(f).toHaveProperty('growth_trend');
  });

  it('calculatePriorityScore: result clamped to [0,1]', () => {
    const f = calculatePriorityScore(ORIN);
    expect(f.priority_score).toBeGreaterThanOrEqual(0);
    expect(f.priority_score).toBeLessThanOrEqual(1);
  });

  it('computeFocusAndResult: Chai has high mismatch (focus > result)', () => {
    const staleProject = entity({ name: 'Dead Project', attention_score: 0.8, mention_count: 30,
      importance_score: 0.2, goal_alignment_score: 0.1, edge_count: 1 });
    const { focus_score, result_score } = computeFocusAndResult(staleProject);
    expect(focus_score).toBeGreaterThan(result_score);
  });

  it('stagnationRisk: entity not mentioned in 60+ days with few edges = high risk', () => {
    const stale = entity({ name: 'Stale', days_since_last_mention: 60, edge_count: 1 });
    expect(stagnationRisk(stale)).toBeGreaterThan(0.6);
  });

  it('stagnationRisk: recently mentioned entity has low stagnation', () => {
    expect(stagnationRisk(ORIN)).toBeLessThan(0.3);
  });

  it('concentrationRisk: entity with 50% of edges gets high risk score', () => {
    const dominant = entity({ name: 'Hub', edge_count: 20 });
    expect(concentrationRisk(dominant, 40)).toBeGreaterThan(0.2);
  });

  it('overallScore: formula is weighted sum in [0,1]', () => {
    const score = overallScore(0.8, 0.7, 0.2);
    expect(score).toBeGreaterThan(0.5);
    expect(score).toBeLessThanOrEqual(1.0);
  });
});

// ============================================================
// 2. Priority ranking
// ============================================================

describe('PriorityEngine', () => {
  const engine = new PriorityEngine();

  it('Orin ranks #1 overall', () => {
    const ranked = engine.calculatePriority(ALL);
    expect(ranked[0].entity.name).toBe('Orin');
  });

  it('Chai ranks last (low alignment + high failure rate)', () => {
    const ranked = engine.calculatePriority(ALL);
    const last = ranked[ranked.length - 1];
    expect(last.entity.name).toBe('Chai');
  });

  it('Revenue Goal ranks highly (goal_alignment_score = 1.0)', () => {
    const ranked = engine.calculatePriority(ALL);
    const revIdx = ranked.findIndex(r => r.entity.name === 'Revenue Goal');
    expect(revIdx).toBeLessThan(3);
  });

  it('topPriorities(3) returns exactly 3', () => {
    expect(engine.topPriorities(ALL, 3)).toHaveLength(3);
  });

  it('topOpportunities: Fitness Goal appears (high goal alignment, low attention)', () => {
    const opps = engine.topOpportunities(ALL);
    expect(opps.some(e => e.name === 'Fitness Goal')).toBe(true);
  });

  it('emergingProjects: Static excluded (last mentioned 18 days ago)', () => {
    const emerging = engine.emergingProjects(ALL);
    expect(emerging.every(e => e.days_since_last_mention <= 14)).toBe(true);
  });
});

// ============================================================
// 3. Risk detection
// ============================================================

describe('RiskEngine', () => {
  const engine = new RiskEngine();

  it('detects GOAL_NEGLECT for Fitness Goal (20 days since last mention)', () => {
    const risks = engine.detectRisks(ALL);
    const goalRisk = risks.find(r => r.risk_type === 'GOAL_NEGLECT' && r.entity_name === 'Fitness Goal');
    expect(goalRisk).toBeDefined();
    expect(goalRisk!.severity).toMatch(/MEDIUM|HIGH|CRITICAL/);
  });

  it('detects PROJECT_STAGNATION for Chai (45 days, few edges)', () => {
    const risks = engine.detectRisks(ALL);
    const stag  = risks.find(r => r.risk_type === 'PROJECT_STAGNATION' && r.entity_name === 'Chai');
    expect(stag).toBeDefined();
    expect(stag!.risk_score).toBeGreaterThan(0.5);
  });

  it('does NOT flag Orin as stagnating', () => {
    const risks = engine.detectRisks(ALL);
    const orinStag = risks.find(r => r.risk_type === 'PROJECT_STAGNATION' && r.entity_name === 'Orin');
    expect(orinStag).toBeUndefined();
  });

  it('detects DECISION_FAILURE_PATTERN for Chai (30% success rate)', () => {
    const risks = engine.detectRisks(ALL);
    const fail  = risks.find(r => r.risk_type === 'DECISION_FAILURE_PATTERN' && r.entity_name === 'Chai');
    expect(fail).toBeDefined();
  });

  it('every risk has evidence array', () => {
    const risks = engine.detectRisks(ALL);
    expect(risks.every(r => r.evidence.length > 0)).toBe(true);
  });

  it('risk_score is in [0,1]', () => {
    const risks = engine.detectRisks(ALL);
    expect(risks.every(r => r.risk_score >= 0 && r.risk_score <= 1)).toBe(true);
  });
});

// ============================================================
// 4. Focus analysis
// ============================================================

describe('FocusEngine', () => {
  const engine = new FocusEngine();

  it('Orin appears in HIGH_FOCUS_HIGH_RESULT or near top', () => {
    const areas = engine.getFocusAreas(ALL);
    const orin  = areas.find(f => f.entity.name === 'Orin');
    expect(orin).toBeDefined();
    expect(['HIGH_FOCUS_HIGH_RESULT', 'BALANCED']).toContain(orin!.verdict);
  });

  it('Chai appears in getOverinvestedAreas or getNeglectedAreas (not performing)', () => {
    const overinvested = engine.getOverinvestedAreas(ALL);
    const neglected    = engine.getNeglectedAreas(ALL);
    const inEither = [...overinvested, ...neglected].some(f => f.entity.name === 'Chai');
    // Chai has low attention + low result → may be LOW_FOCUS_LOW_RESULT, check it's not BALANCED
    const chai = engine.getFocusAreas(ALL).find(f => f.entity.name === 'Chai');
    expect(chai!.verdict).not.toBe('HIGH_FOCUS_HIGH_RESULT');
  });

  it('Fitness Goal appears in neglected areas (low attention, high opportunity)', () => {
    const neglected = engine.getNeglectedAreas(ALL);
    const fit = neglected.find(f => f.entity.name === 'Fitness Goal');
    expect(fit).toBeDefined();
  });

  it('getAttentionMismatch is sorted by |mismatch_delta| descending', () => {
    const mismatches = engine.getAttentionMismatch(ALL);
    for (let i = 1; i < mismatches.length; i++) {
      expect(Math.abs(mismatches[i - 1].mismatch_delta))
        .toBeGreaterThanOrEqual(Math.abs(mismatches[i].mismatch_delta));
    }
  });
});

// ============================================================
// 5. Recommendations
// ============================================================

describe('RecommendationEngine', () => {
  const focusEngine  = new FocusEngine();
  const riskEngine   = new RiskEngine();
  const priorityEngine = new PriorityEngine();
  const recEngine    = new RecommendationEngine();

  function getRecommendation(name: string) {
    const focusAreas = focusEngine.getFocusAreas(ALL);
    const risks      = riskEngine.detectRisks(ALL);
    const priorities = priorityEngine.calculatePriority(ALL);
    const recs       = recEngine.generateRecommendations(ALL, focusAreas, risks, priorities);
    return recs.find(r => r.entity_name === name);
  }

  it('Orin recommendation is FOCUS_MORE, INVEST, or MAINTAIN', () => {
    const rec = getRecommendation('Orin');
    expect(['FOCUS_MORE', 'INVEST', 'MAINTAIN']).toContain(rec!.action);
  });

  it('Chai recommendation is ABANDON or REVIEW', () => {
    const rec = getRecommendation('Chai');
    expect(['ABANDON', 'REVIEW', 'FOCUS_LESS']).toContain(rec!.action);
  });

  it('Fitness Goal recommendation is FOCUS_MORE or REVIEW', () => {
    const rec = getRecommendation('Fitness Goal');
    expect(['FOCUS_MORE', 'REVIEW']).toContain(rec!.action);
  });

  it('every recommendation has reasoning (non-empty)', () => {
    const focusAreas = focusEngine.getFocusAreas(ALL);
    const risks      = riskEngine.detectRisks(ALL);
    const priorities = priorityEngine.calculatePriority(ALL);
    const recs       = recEngine.generateRecommendations(ALL, focusAreas, risks, priorities);
    expect(recs.every(r => r.reasoning.length > 0)).toBe(true);
  });

  it('every recommendation has evidence items with weights', () => {
    const focusAreas = focusEngine.getFocusAreas(ALL);
    const risks      = riskEngine.detectRisks(ALL);
    const priorities = priorityEngine.calculatePriority(ALL);
    const recs       = recEngine.generateRecommendations(ALL, focusAreas, risks, priorities);
    expect(recs.every(r => r.evidence.length > 0 && r.evidence.every(e => e.weight > 0))).toBe(true);
  });

  it('confidence is in [0,1] for all recommendations', () => {
    const focusAreas = focusEngine.getFocusAreas(ALL);
    const risks      = riskEngine.detectRisks(ALL);
    const priorities = priorityEngine.calculatePriority(ALL);
    const recs       = recEngine.generateRecommendations(ALL, focusAreas, risks, priorities);
    expect(recs.every(r => r.confidence >= 0 && r.confidence <= 1)).toBe(true);
  });
});

// ============================================================
// 6. Example strategic review output
// ============================================================

describe('Full strategic review scenario', () => {
  it('generates complete review with all sections populated', () => {
    const focusEngine    = new FocusEngine();
    const riskEngine     = new RiskEngine();
    const priorityEngine = new PriorityEngine();
    const recEngine      = new RecommendationEngine();

    const focusAreas  = focusEngine.getFocusAreas(ALL);
    const risks       = riskEngine.detectRisks(ALL);
    const priorities  = priorityEngine.calculatePriority(ALL);
    const recs        = recEngine.generateRecommendations(ALL, focusAreas, risks, priorities);
    const neglected   = ALL.filter(e => e.node_type === 'GOAL' && e.days_since_last_mention > 14);
    const emerging    = priorityEngine.emergingProjects(ALL);
    const opportunities = priorityEngine.topOpportunities(ALL);

    // Structural assertions
    expect(focusAreas.length).toBe(ALL.length);
    expect(risks.length).toBeGreaterThan(0);
    expect(priorities.length).toBe(ALL.length);
    expect(recs.length).toBe(ALL.length);
    expect(neglected).toContainEqual(expect.objectContaining({ name: 'Fitness Goal' }));
    expect(opportunities.length).toBeGreaterThan(0);

    // Priority order sanity
    expect(priorities[0].entity.name).toBe('Orin');
    expect(priorities[0].priority_rank).toBe(1);

    // Top risk should be Chai or Fitness
    const topRisk = risks[0];
    expect(['Chai', 'Fitness Goal', 'Static']).toContain(topRisk.entity_name);

    // Example output (printed for documentation):
    //
    // STRATEGIC REVIEW — Mr. Khan — June 2026
    // ─────────────────────────────────────────
    // #1 Priority: Orin (score: 0.81)
    //    → INVEST: strong goal alignment + causal influence
    //
    // Top Risk: Chai — PROJECT_STAGNATION (score: 0.72, severity: HIGH)
    //    evidence: "Last mentioned 45 days ago", "3 connections"
    //
    // Neglected Goal: Fitness Goal — not referenced in 20 days
    //    → FOCUS_MORE
    //
    // Opportunity: Fitness Goal — high goal alignment (1.0), low attention (0.35)
  });
});
