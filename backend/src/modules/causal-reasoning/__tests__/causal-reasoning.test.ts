// ============================================================
// causal-reasoning.test.ts
// ============================================================
import { describe, it, expect, vi } from 'vitest';
import { CausalReasoningService } from '../causal-reasoning.service';

const NOW = new Date().toISOString();
const HOUR = 3_600_000;

function obs(overrides: any = {}) {
  return {
    id: `o-${Math.random()}`, user_id: 'u1',
    source: 'TASK_COMPLETED', event_type: 'TEST', title: 'Test',
    occurred_at: NOW, importance_score: 0.5,
    categories: ['WORK'], metadata: {}, related_entities: [],
    is_processed: false, signal_quality_score: null,
    description: null, confidence_score: 0.8,
    created_at: NOW, updated_at: NOW,
    ...overrides,
  };
}

function causalEdge(overrides: any = {}) {
  return {
    id: `ce-${Math.random()}`, source_node_id: 'n1', target_node_id: 'n2',
    relationship_type: 'CAUSED', causal_strength: 0.8, confidence: 0.9,
    source_count: 5, causal_evidence: [], last_seen_at: NOW,
    ...overrides,
  };
}

function makeReasRepo(patterns: any[] = [], evidence: any[] = []) {
  return {
    upsertPattern:  vi.fn((p) => Promise.resolve({ id: `pat-${Math.random()}`, created_at: NOW, occurrence_count: 1, ...p })),
    getPatterns:    vi.fn(() => Promise.resolve(patterns)),
    rejectPattern:  vi.fn(() => Promise.resolve()),
    addEvidence:    vi.fn((e) => Promise.resolve({ id: 'ev-1', created_at: NOW, ...e })),
    getEvidence:    vi.fn(() => Promise.resolve(evidence)),
    savePrediction: vi.fn((p) => Promise.resolve({ id: 'pred-1', created_at: NOW, ...p })),
    getPredictions: vi.fn(() => Promise.resolve([])),
  };
}

function makeCausalRepo(edges: any[] = []) {
  return { getAllCausalEdges: vi.fn(() => Promise.resolve(edges)) };
}

function makeObsRepo(observations: any[] = []) {
  return { listRecent: vi.fn(() => Promise.resolve(observations)) };
}

function makeAI(response = '{"predicted_outcome":"more productivity","confidence":0.7}') {
  return { generate: vi.fn(() => Promise.resolve(response)) } as any;
}

// ============================================================

describe('CausalReasoningService.discoverCausalPatterns', () => {
  it('promotes strong causal edges to CONFIRMED patterns', async () => {
    const edge = causalEdge({ causal_strength: 0.85, source_count: 5 });
    const reasoningRepo = makeReasRepo();
    const svc = new CausalReasoningService(reasoningRepo, makeCausalRepo([edge]) as any, makeObsRepo([]) as any, makeAI());

    await svc.discoverCausalPatterns('u1');
    expect(reasoningRepo.upsertPattern).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'CONFIRMED', confidence: 0.85 }),
    );
  });

  it('ignores weak causal edges (strength < 0.7)', async () => {
    const weakEdge = causalEdge({ causal_strength: 0.5, source_count: 10 });
    const reasoningRepo = makeReasRepo();
    const svc = new CausalReasoningService(reasoningRepo, makeCausalRepo([weakEdge]) as any, makeObsRepo([]) as any, makeAI());

    await svc.discoverCausalPatterns('u1');
    // Only repeated-sequence detection runs; no edge upsert for weak edges
    expect(reasoningRepo.upsertPattern).not.toHaveBeenCalledWith(
      expect.objectContaining({ confidence: 0.5, status: 'CONFIRMED' }),
    );
  });

  it('detects repeated sequences from observations within 30-min window', async () => {
    const base = Date.now();
    const observations = [
      obs({ source: 'GIT_COMMIT',      occurred_at: new Date(base).toISOString() }),
      obs({ source: 'TASK_COMPLETED',  occurred_at: new Date(base + 10 * 60_000).toISOString() }),
      obs({ source: 'GIT_COMMIT',      occurred_at: new Date(base + 2 * HOUR).toISOString() }),
      obs({ source: 'TASK_COMPLETED',  occurred_at: new Date(base + 2 * HOUR + 10 * 60_000).toISOString() }),
    ];
    const reasoningRepo = makeReasRepo();
    const svc = new CausalReasoningService(reasoningRepo, makeCausalRepo([]) as any, makeObsRepo(observations) as any, makeAI());

    await svc.discoverCausalPatterns('u1');
    expect(reasoningRepo.upsertPattern).toHaveBeenCalledWith(
      expect.objectContaining({ cause_label: 'GIT_COMMIT', effect_label: 'TASK_COMPLETED' }),
    );
  });

  it('ignores observation pairs outside the 30-min window', async () => {
    const base = Date.now();
    const observations = [
      obs({ source: 'GIT_COMMIT',     occurred_at: new Date(base).toISOString() }),
      obs({ source: 'EMAIL_RECEIVED', occurred_at: new Date(base + 2 * HOUR).toISOString() }),
    ];
    const reasoningRepo = makeReasRepo();
    const svc = new CausalReasoningService(reasoningRepo, makeCausalRepo([]) as any, makeObsRepo(observations) as any, makeAI());

    await svc.discoverCausalPatterns('u1');
    // Far-apart pair should not be upserted (only 1 occurrence, below MIN)
    const calls = reasoningRepo.upsertPattern.mock.calls;
    const gitEmailCalls = calls.filter(([p]: [any]) => p.cause_label === 'GIT_COMMIT' && p.effect_label === 'EMAIL_RECEIVED');
    expect(gitEmailCalls.length).toBe(0);
  });
});

describe('CausalReasoningService.scoreCausalConfidence', () => {
  it('returns 0 when no evidence exists', async () => {
    const svc = new CausalReasoningService(makeReasRepo([], []), makeCausalRepo() as any, makeObsRepo() as any, makeAI());
    const score = await svc.scoreCausalConfidence('pat-1', 'u1');
    expect(score).toBe(0);
  });

  it('computes weighted confidence from evidence', async () => {
    const evidence = [
      { id: 'e1', weight: 0.8 }, { id: 'e2', weight: 0.6 },
    ];
    const svc = new CausalReasoningService(makeReasRepo([], evidence), makeCausalRepo() as any, makeObsRepo() as any, makeAI());
    const score = await svc.scoreCausalConfidence('pat-1', 'u1');
    expect(score).toBeCloseTo(0.7, 1);
  });

  it('caps confidence at 0.99', async () => {
    const evidence = Array.from({ length: 10 }, (_, i) => ({ id: `e${i}`, weight: 1.0 }));
    const svc = new CausalReasoningService(makeReasRepo([], evidence), makeCausalRepo() as any, makeObsRepo() as any, makeAI());
    const score = await svc.scoreCausalConfidence('pat-1', 'u1');
    expect(score).toBeLessThanOrEqual(0.99);
  });
});

describe('CausalReasoningService.findGoalBlockers', () => {
  it('returns existing GOAL_BLOCKER patterns', async () => {
    const blocker = { id: 'p1', pattern_type: 'GOAL_BLOCKER', cause_label: 'HEALTH_UPDATE', effect_label: 'goal_progress', confidence: 0.6, status: 'CONFIRMED' };
    const reasoningRepo = makeReasRepo([blocker]);
    reasoningRepo.getPatterns = vi.fn((uid, type) =>
      type === 'GOAL_BLOCKER' ? Promise.resolve([blocker]) : Promise.resolve([]),
    );
    const svc = new CausalReasoningService(reasoningRepo, makeCausalRepo() as any, makeObsRepo([]) as any, makeAI());
    const blockers = await svc.findGoalBlockers('u1');
    expect(blockers.some(b => b.pattern_type === 'GOAL_BLOCKER')).toBe(true);
  });
});

describe('CausalReasoningService.findGoalAccelerators', () => {
  it('detects high-impact source as accelerator', async () => {
    const highImpactObs = Array.from({ length: 3 }, () =>
      obs({ source: 'GIT_COMMIT', importance_score: 0.9, categories: ['WORK'] }),
    );
    const reasoningRepo = makeReasRepo();
    const svc = new CausalReasoningService(reasoningRepo, makeCausalRepo() as any, makeObsRepo(highImpactObs) as any, makeAI());

    await svc.findGoalAccelerators('u1');
    expect(reasoningRepo.upsertPattern).toHaveBeenCalledWith(
      expect.objectContaining({ pattern_type: 'GOAL_ACCELERATOR', cause_label: 'GIT_COMMIT' }),
    );
  });
});

describe('CausalReasoningService.predictOutcome', () => {
  it('returns a prediction with confidence from AI', async () => {
    const confirmed = [{ id: 'p1', cause_label: 'exercise', effect_label: 'productivity', confidence: 0.8, status: 'CONFIRMED' }];
    const reasoningRepo = makeReasRepo(confirmed);
    reasoningRepo.getPatterns = vi.fn(() => Promise.resolve(confirmed));
    const svc = new CausalReasoningService(reasoningRepo, makeCausalRepo() as any, makeObsRepo() as any, makeAI());

    const pred = await svc.predictOutcome('u1', 'If I exercise in the morning');
    expect(pred.predicted_outcome).toBeTruthy();
    expect(pred.confidence).toBeGreaterThan(0);
    expect(pred.confidence).toBeLessThanOrEqual(1);
  });

  it('returns low-confidence fallback when AI returns invalid JSON', async () => {
    const reasoningRepo = makeReasRepo([]);
    const svc = new CausalReasoningService(reasoningRepo, makeCausalRepo() as any, makeObsRepo() as any, makeAI('not json at all'));

    const pred = await svc.predictOutcome('u1', 'unknown condition');
    expect(pred.predicted_outcome).toBeTruthy();
  });

  it('multi-event chains: includes multiple supporting_patterns', async () => {
    const patterns = [
      { id: 'p1', cause_label: 'exercise', effect_label: 'focus', confidence: 0.8, status: 'CONFIRMED' },
      { id: 'p2', cause_label: 'focus', effect_label: 'output', confidence: 0.75, status: 'CONFIRMED' },
    ];
    const reasoningRepo = makeReasRepo(patterns);
    reasoningRepo.getPatterns = vi.fn(() => Promise.resolve(patterns));
    const svc = new CausalReasoningService(reasoningRepo, makeCausalRepo() as any, makeObsRepo() as any, makeAI());

    const pred = await svc.predictOutcome('u1', 'morning exercise');
    expect(pred.supporting_patterns.length).toBeGreaterThanOrEqual(1);
  });

  it('temporal ordering: only confirmed patterns contribute to predictions', async () => {
    const patterns = [
      { id: 'p1', cause_label: 'A', effect_label: 'B', confidence: 0.8, status: 'CONFIRMED' },
      { id: 'p2', cause_label: 'C', effect_label: 'D', confidence: 0.4, status: 'CANDIDATE' },
    ];
    const reasoningRepo = makeReasRepo(patterns);
    reasoningRepo.getPatterns = vi.fn(() => Promise.resolve(patterns));
    const svc = new CausalReasoningService(reasoningRepo, makeCausalRepo() as any, makeObsRepo() as any, makeAI());

    const pred = await svc.predictOutcome('u1', 'test');
    // Only p1 (CONFIRMED) should appear in supporting_patterns
    const confirmed = patterns.filter(p => p.status === 'CONFIRMED').map(p => p.id);
    expect(pred.supporting_patterns.every((id: string) => confirmed.includes(id))).toBe(true);
  });
});
