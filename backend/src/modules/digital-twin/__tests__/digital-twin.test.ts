// ============================================================
// digital-twin.test.ts
// ============================================================
import { describe, it, expect, vi } from 'vitest';
import { DigitalTwinService } from '../digital-twin.service';

const NOW = new Date().toISOString();

function makeRepo(profile: any = null, traits: any[] = [], predictions: any[] = []) {
  return {
    getProfile:     vi.fn(() => Promise.resolve(profile)),
    upsertProfile:  vi.fn((uid, patch) => Promise.resolve({ id: 'p1', user_id: uid, version: 1, ...patch, created_at: NOW, updated_at: NOW })),
    getTraits:      vi.fn(() => Promise.resolve(traits)),
    upsertTrait:    vi.fn((uid, pid, t) => Promise.resolve({ id: 't1', user_id: uid, profile_id: pid, ...t, first_seen_at: NOW, last_seen_at: NOW })),
    savePrediction: vi.fn((uid, pid, p) => Promise.resolve({ id: 'pred-1', user_id: uid, profile_id: pid, ...p, created_at: NOW })),
    getPredictions: vi.fn(() => Promise.resolve(predictions)),
  };
}

function makeAI() {
  return {
    generate: vi.fn(() => Promise.resolve('{"prediction":"Work on FRIDAY","confidence":0.8,"reasoning":"High importance"}')),
  } as any;
}

function makeGraph(nodes: any[] = []) {
  return { getMostImportantNodes: vi.fn(() => Promise.resolve(nodes)) } as any;
}

function makeObs(observations: any[] = []) {
  return { listRecent: vi.fn(() => Promise.resolve(observations)) } as any;
}

function makeDecisions(decisions: any[] = []) {
  return { listDecisions: vi.fn(() => Promise.resolve(decisions)) } as any;
}

const node = (overrides = {}) => ({
  id: 'n1', name: 'FRIDAY', node_type: 'PROJECT', importance_score: 0.9,
  source_memory_ids: [], last_mentioned_at: NOW, mention_count: 5, ...overrides,
});

const obs = (overrides = {}) => ({
  id: 'o1', occurred_at: new Date('2026-01-01T09:00:00Z').toISOString(),
  categories: ['WORK'], source: 'TASK_COMPLETED', importance_score: 0.7, ...overrides,
});

// ============================================================

describe('DigitalTwinService.getProfile', () => {
  it('returns null when no profile exists', async () => {
    const svc = new DigitalTwinService(makeRepo(null), makeAI(), makeGraph(), makeObs(), makeDecisions());
    expect(await svc.getProfile('u1')).toBeNull();
  });

  it('returns profile when it exists', async () => {
    const profile = { id: 'p1', user_id: 'u1', version: 1 };
    const svc = new DigitalTwinService(makeRepo(profile), makeAI(), makeGraph(), makeObs(), makeDecisions());
    expect(await svc.getProfile('u1')).toEqual(profile);
  });
});

describe('DigitalTwinService.generateSelfModel', () => {
  it('builds a self model with profile, traits, predictions', async () => {
    const repo = makeRepo();
    const svc = new DigitalTwinService(
      repo, makeAI(),
      makeGraph([node(), node({ id: 'n2', name: 'Khan', node_type: 'PERSON', importance_score: 0.7 })]),
      makeObs([obs(), obs({ occurred_at: new Date('2026-01-01T14:00:00Z').toISOString(), categories: ['WORK'] })]),
      makeDecisions([{ id: 'd1', status: 'COMPLETED', confidence_score: 0.8, expected_success_probability: 0.8 }]),
    );

    const model = await svc.generateSelfModel('u1');
    expect(model.profile).toBeTruthy();
    expect(model.profile.user_id).toBe('u1');
    expect(model.generated_at).toBeTruthy();
    expect(Array.isArray(model.predictions)).toBe(true);
    expect(Array.isArray(model.traits)).toBe(true);
  });

  it('sets top_goals from GOAL nodes', async () => {
    const repo = makeRepo();
    const svc = new DigitalTwinService(
      repo, makeAI(),
      makeGraph([node({ node_type: 'GOAL', name: 'Launch FRIDAY' })]),
      makeObs([]), makeDecisions([]),
    );
    const model = await svc.generateSelfModel('u1');
    expect(model.profile.top_goals).toContain('Launch FRIDAY');
  });

  it('sets productivity_peak from observation timestamps', async () => {
    const repo = makeRepo();
    const svc = new DigitalTwinService(
      repo, makeAI(), makeGraph([]),
      makeObs([obs({ occurred_at: '2026-01-01T08:00:00Z' }), obs({ occurred_at: '2026-01-01T09:00:00Z' })]),
      makeDecisions([]),
    );
    const model = await svc.generateSelfModel('u1');
    expect(model.profile.productivity_peak).toBe('morning');
  });

  it('assigns AGGRESSIVE risk profile for high-confidence decisions', async () => {
    const repo = makeRepo();
    const decisions = Array.from({ length: 5 }, (_, i) => ({
      id: `d${i}`, status: 'COMPLETED', confidence_score: 0.9, expected_success_probability: 0.9,
    }));
    const svc = new DigitalTwinService(repo, makeAI(), makeGraph([]), makeObs([]), makeDecisions(decisions));
    const model = await svc.generateSelfModel('u1');
    expect(model.profile.risk_profile).toBe('AGGRESSIVE');
  });
});

describe('DigitalTwinService.predictPreference', () => {
  it('returns a prediction with confidence and evidence', async () => {
    const svc = new DigitalTwinService(makeRepo(), makeAI(), makeGraph(), makeObs(), makeDecisions());
    const pred = await svc.predictPreference('u1', 'What would I work on next?');
    expect(pred.confidence).toBeGreaterThan(0);
    expect(pred.prediction).toBeTruthy();
    expect(Array.isArray(pred.evidence)).toBe(true);
  });
});

describe('DigitalTwinService.predictPriority', () => {
  it('returns LIKELY_PRIORITY prediction backed by graph nodes', async () => {
    const svc = new DigitalTwinService(
      makeRepo(), makeAI(),
      makeGraph([node({ importance_score: 0.9 })]),
      makeObs(), makeDecisions(),
    );
    const pred = await svc.predictPriority('u1');
    expect(pred.prediction_type).toBe('LIKELY_PRIORITY');
    expect(pred.confidence).toBeGreaterThan(0);
    expect(pred.supporting_node_ids).toContain('n1');
  });

  it('returns low confidence when no nodes exist', async () => {
    const svc = new DigitalTwinService(makeRepo(), makeAI(), makeGraph([]), makeObs(), makeDecisions());
    const pred = await svc.predictPriority('u1');
    expect(pred.confidence).toBeLessThan(0.5);
  });
});

describe('DigitalTwinService.predictDecision', () => {
  it('returns a prediction for a given scenario', async () => {
    const svc = new DigitalTwinService(makeRepo(), makeAI(), makeGraph(), makeObs(), makeDecisions());
    const pred = await svc.predictDecision('u1', 'Client asks for 2-week deadline on big project');
    expect(pred).toBeTruthy();
    expect(pred.prediction).toBeTruthy();
  });
});
