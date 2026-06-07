// ============================================================
// observation.test.ts — Observation Engine test suite
// Run: npx vitest run observation.test.ts
// All tests use in-memory mocks — no DB required.
// ============================================================

import { describe, it, expect, vi } from 'vitest';
import { ObservationClassifier }   from '../observation-classifier';
import { calculateImportanceScore, scoreObservationBatch } from '../observation.scoring';
import { ObservationProcessor }    from '../observation.processor';
import { ObservationInsights }     from '../observation-insights';
import type { Observation, CreateObservationInput } from '../observation.types';

// ============================================================
// Fixtures
// ============================================================

const UID = 'user-1';
const NOW = new Date('2026-06-06T14:00:00Z');
const DAY = 86_400_000;

function obs(overrides: Partial<Observation> = {}): Observation {
  return {
    id: 'obs-1', user_id: UID,
    source: 'MANUAL', event_type: 'note',
    title: 'Worked on Orin', description: null,
    occurred_at: NOW.toISOString(),
    importance_score: 0.5, confidence_score: 1.0,
    categories: ['WORK'], metadata: {}, related_entities: [],
    is_processed: false,
    created_at: NOW.toISOString(), updated_at: NOW.toISOString(),
    ...overrides,
  };
}

function input(overrides: Partial<CreateObservationInput> = {}): CreateObservationInput {
  return {
    user_id: UID, source: 'MANUAL', event_type: 'note',
    title: 'Worked on Orin',
    ...overrides,
  };
}

// ============================================================
// 1. Classification
// ============================================================

describe('ObservationClassifier', () => {
  const clf = new ObservationClassifier();

  it('GIT_COMMIT → primary WORK, secondary PROJECT', () => {
    const r = clf.classify('GIT_COMMIT', 'feat: add scholarship matching to Orin');
    expect(r.primary_category).toBe('WORK');
    expect(r.categories).toContain('PROJECT');
  });

  it('HEALTH_UPDATE → primary HEALTH, high confidence', () => {
    const r = clf.classify('HEALTH_UPDATE', 'Body fat measured at 15%');
    expect(r.primary_category).toBe('HEALTH');
    expect(r.confidence).toBeGreaterThan(0.9);
  });

  it('REVENUE_EVENT → primary FINANCE', () => {
    const r = clf.classify('REVENUE_EVENT', 'Khan Designs invoice paid');
    expect(r.primary_category).toBe('FINANCE');
  });

  it('PROJECT_MILESTONE → primary PROJECT, high confidence', () => {
    const r = clf.classify('PROJECT_MILESTONE', 'Orin beta shipped to first users');
    expect(r.primary_category).toBe('PROJECT');
    expect(r.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('MANUAL with gym keyword → adds HEALTH category', () => {
    const r = clf.classify('MANUAL', 'Did a gym session and hit 3 sets');
    expect(r.categories).toContain('HEALTH');
  });

  it('MANUAL with Orin keyword → adds PROJECT category', () => {
    const r = clf.classify('MANUAL', 'Spent 3 hours working on Orin today');
    expect(r.categories).toContain('PROJECT');
  });

  it('MANUAL with revenue keyword → adds FINANCE category', () => {
    const r = clf.classify('MANUAL', 'Received payment for Khan Designs invoice');
    expect(r.categories).toContain('FINANCE');
  });

  it('BOOK_READING → primary LEARNING, secondary PERSONAL', () => {
    const r = clf.classify('BOOK_READING', 'Read 30 pages of Atomic Habits');
    expect(r.primary_category).toBe('LEARNING');
    expect(r.categories).toContain('PERSONAL');
  });

  it('APP_USAGE → primary SYSTEM', () => {
    const r = clf.classify('APP_USAGE', 'Used VS Code for 4 hours');
    expect(r.primary_category).toBe('SYSTEM');
  });

  it('SOCIAL_INTERACTION → primary SOCIAL', () => {
    const r = clf.classify('SOCIAL_INTERACTION', 'Lunch with Nidha');
    expect(r.primary_category).toBe('SOCIAL');
  });

  it('multi-label: GIT_COMMIT about Orin → WORK + PROJECT', () => {
    const r = clf.classify('GIT_COMMIT', 'fix: scholarship scraper for Orin');
    expect(r.categories).toContain('WORK');
    expect(r.categories).toContain('PROJECT');
    expect(r.categories.length).toBeGreaterThanOrEqual(2);
  });

  it('confidence decreases slightly with more labels', () => {
    const single = clf.classify('GIT_COMMIT', 'Minor cleanup');
    const multi  = clf.classify('GIT_COMMIT', 'Orin scholarship update for revenue goal');
    expect(single.confidence).toBeGreaterThanOrEqual(multi.confidence);
  });
});

// ============================================================
// 2. Scoring
// ============================================================

describe('calculateImportanceScore', () => {
  it('PROJECT_MILESTONE scores higher than APP_USAGE', () => {
    const milestone = calculateImportanceScore(
      obs({ source: 'PROJECT_MILESTONE', title: 'Orin beta launched' }),
      { sourceFrequencyInWindow: 1, entityImportanceScores: [0.8], goalAlignedEntityCount: 1, projectRelatedEntityCount: 1 },
    );
    const appUsage = calculateImportanceScore(
      obs({ source: 'APP_USAGE', title: 'Used Chrome for 2 hours' }),
      { sourceFrequencyInWindow: 20, entityImportanceScores: [], goalAlignedEntityCount: 0, projectRelatedEntityCount: 0 },
    );
    expect(milestone.final_score).toBeGreaterThan(appUsage.final_score);
  });

  it('frequency: high frequency source scores lower', () => {
    const rare   = calculateImportanceScore(obs({ source: 'REVENUE_EVENT' }), { sourceFrequencyInWindow: 1,  entityImportanceScores: [], goalAlignedEntityCount: 0, projectRelatedEntityCount: 0 });
    const common = calculateImportanceScore(obs({ source: 'REVENUE_EVENT' }), { sourceFrequencyInWindow: 40, entityImportanceScores: [], goalAlignedEntityCount: 0, projectRelatedEntityCount: 0 });
    expect(rare.frequency_score).toBeGreaterThan(common.frequency_score);
  });

  it('goal alignment boost: goal-related entity raises score', () => {
    const aligned   = calculateImportanceScore(obs({ related_entities: ['13% Body Fat', 'Orin'] }), { sourceFrequencyInWindow: 1, entityImportanceScores: [0.8, 0.7], goalAlignedEntityCount: 1, projectRelatedEntityCount: 1 });
    const unaligned = calculateImportanceScore(obs({ related_entities: [] }),                        { sourceFrequencyInWindow: 1, entityImportanceScores: [], goalAlignedEntityCount: 0, projectRelatedEntityCount: 0 });
    expect(aligned.final_score).toBeGreaterThan(unaligned.final_score);
  });

  it('final_score is always in [0, 1]', () => {
    const score = calculateImportanceScore(
      obs({ source: 'DEVICE_ACTIVITY' }),
      { sourceFrequencyInWindow: 100, entityImportanceScores: [], goalAlignedEntityCount: 0, projectRelatedEntityCount: 0 },
    );
    expect(score.final_score).toBeGreaterThanOrEqual(0);
    expect(score.final_score).toBeLessThanOrEqual(1);
  });

  it('score breakdown has all 5 factors', () => {
    const bd = calculateImportanceScore(obs(), { sourceFrequencyInWindow: 5, entityImportanceScores: [0.6], goalAlignedEntityCount: 0, projectRelatedEntityCount: 1 });
    expect(bd).toHaveProperty('frequency_score');
    expect(bd).toHaveProperty('rarity_score');
    expect(bd).toHaveProperty('entity_score');
    expect(bd).toHaveProperty('goal_alignment');
    expect(bd).toHaveProperty('project_relevance');
  });
});

describe('scoreObservationBatch', () => {
  it('ranks PROJECT_MILESTONE before APP_USAGE', () => {
    const batch = [
      obs({ id: 'app', source: 'APP_USAGE', title: 'Used Chrome' }),
      obs({ id: 'ms',  source: 'PROJECT_MILESTONE', title: 'Orin v1 shipped' }),
    ];
    const ranked = scoreObservationBatch(batch);
    expect(ranked[0].obs.id).toBe('ms');
  });
});

// ============================================================
// 3. Processor
// ============================================================

describe('ObservationProcessor', () => {
  function makeRepo(created: Observation) {
    return {
      create:         vi.fn(() => Promise.resolve(created)),
      getById:        vi.fn(() => Promise.resolve(created)),
      update:         vi.fn((_id: string, _uid: string, patch: any) => Promise.resolve({ ...created, ...patch })),
      listUnprocessed: vi.fn(() => Promise.resolve([])),
      markProcessed:  vi.fn(() => Promise.resolve()),
    } as any;
  }

  it('process() classifies and persists with enriched categories', async () => {
    const saved = obs({ source: 'GIT_COMMIT', categories: ['WORK', 'PROJECT'] });
    const repo  = makeRepo(saved);
    const clf   = new ObservationClassifier();
    const proc  = new ObservationProcessor(repo, clf);

    const result = await proc.process(input({ source: 'GIT_COMMIT', title: 'feat: Orin scholarship API' }));

    expect(repo.create).toHaveBeenCalledOnce();
    const callArg = repo.create.mock.calls[0][0];
    expect(callArg.categories).toContain('WORK');
  });

  it('process() respects caller-provided importance_score override', async () => {
    const saved = obs({ importance_score: 0.95 });
    const repo  = makeRepo(saved);
    const proc  = new ObservationProcessor(repo, new ObservationClassifier());

    await proc.process(input({ importance_score: 0.95 }));

    const arg = repo.create.mock.calls[0][0];
    expect(arg.importance_score).toBe(0.95);
  });

  it('processBatch() processes all inputs', async () => {
    const repo = { create: vi.fn((i: Partial<CreateObservationInput>) => Promise.resolve({ ...obs(), ...i })) } as any;
    const proc = new ObservationProcessor(repo, new ObservationClassifier());

    const inputs = [
      input({ source: 'GIT_COMMIT', title: 'Push to main' }),
      input({ source: 'TASK_COMPLETED', title: 'Shipped Orin onboarding' }),
    ];
    const results = await proc.processBatch(inputs);
    expect(results).toHaveLength(2);
    expect(repo.create).toHaveBeenCalledTimes(2);
  });

  it('drainUnprocessed() marks each observation as processed', async () => {
    const pending = [obs({ id: 'p1' }), obs({ id: 'p2' })];
    const repo = {
      listUnprocessed: vi.fn(() => Promise.resolve(pending)),
      getById:         vi.fn((id: string) => Promise.resolve(pending.find(o => o.id === id) ?? null)),
      update:          vi.fn((_id: string, _uid: string, patch: any) => Promise.resolve({ ...obs(), ...patch })),
      markProcessed:   vi.fn(() => Promise.resolve()),
    } as any;

    const proc  = new ObservationProcessor(repo, new ObservationClassifier());
    const count = await proc.drainUnprocessed(UID);
    expect(count).toBe(2);
    expect(repo.markProcessed).toHaveBeenCalledTimes(2);
  });
});

// ============================================================
// 4. Distribution + trends
// ============================================================

describe('ObservationInsights', () => {
  function makeRepo(observations: Observation[]) {
    return {
      listInRange: vi.fn(() => Promise.resolve(observations)),
      countBySourceInRange: vi.fn((_uid: string, from: Date, to: Date) => {
        // split into two halves for trend detection
        const mid    = new Date((from.getTime() + to.getTime()) / 2);
        const counts: Record<string, number> = {};
        for (const o of observations) {
          const t = new Date(o.occurred_at).getTime();
          if (t >= from.getTime() && t <= to.getTime()) {
            counts[o.source] = (counts[o.source] ?? 0) + 1;
          }
        }
        return Promise.resolve(counts);
      }),
      countByCategoryInRange: vi.fn(() => {
        const counts: Record<string, number> = {};
        for (const o of observations) for (const c of o.categories) counts[c] = (counts[c] ?? 0) + 1;
        return Promise.resolve(counts);
      }),
    } as any;
  }

  it('getObservationDistribution returns correct totals', async () => {
    const observations = [
      obs({ source: 'GIT_COMMIT', categories: ['WORK', 'PROJECT'] }),
      obs({ source: 'GIT_COMMIT', categories: ['WORK', 'PROJECT'] }),
      obs({ source: 'HEALTH_UPDATE', categories: ['HEALTH'] }),
    ];
    const insights = new ObservationInsights(makeRepo(observations));
    const dist = await insights.getObservationDistribution(UID, 30);

    expect(dist.by_source['GIT_COMMIT']).toBe(2);
    expect(dist.by_source['HEALTH_UPDATE']).toBe(1);
    expect(dist.by_category['HEALTH']).toBe(1);
    expect(dist.total).toBe(3);
  });

  it('getTopObservationSources returns sorted by count', async () => {
    const observations = [
      obs({ source: 'GIT_COMMIT' }), obs({ source: 'GIT_COMMIT' }), obs({ source: 'GIT_COMMIT' }),
      obs({ source: 'TASK_COMPLETED' }),
    ];
    const insights = new ObservationInsights(makeRepo(observations));
    const top = await insights.getTopObservationSources(UID, 30, 5);
    expect(top[0].source).toBe('GIT_COMMIT');
    expect(top[0].count).toBe(3);
  });

  it('getAttentionDrift: HEALTH gained if more health obs in recent half', async () => {
    const recent = new Date(NOW.getTime() - 5 * DAY).toISOString();
    const old    = new Date(NOW.getTime() - 25 * DAY).toISOString();

    const observations = [
      obs({ source: 'HEALTH_UPDATE', categories: ['HEALTH'], occurred_at: recent }),
      obs({ source: 'HEALTH_UPDATE', categories: ['HEALTH'], occurred_at: recent }),
      obs({ source: 'HEALTH_UPDATE', categories: ['HEALTH'], occurred_at: old }),
    ];

    const repo = {
      countByCategoryInRange: vi.fn((_uid: string, from: Date, to: Date) => {
        const mid = new Date(NOW.getTime() - 15 * DAY);
        if (to <= mid) return Promise.resolve({ HEALTH: 1 });
        return Promise.resolve({ HEALTH: 2 });
      }),
    } as any;

    vi.setSystemTime(NOW);
    const insights = new ObservationInsights(repo);
    const drift    = await insights.getAttentionDrift(UID, 30);
    expect(drift.gained).toContain('HEALTH');
    vi.useRealTimers();
  });
});

// ============================================================
// 5. Realistic scenario
// ============================================================

describe('Realistic scenario: Friday activity week', () => {
  const clf = new ObservationClassifier();

  it('Orin git commit → WORK + PROJECT', () => {
    const r = clf.classify('GIT_COMMIT', 'feat: add Orin scholarship scraper v2');
    expect(r.categories).toContain('WORK');
    expect(r.categories).toContain('PROJECT');
  });

  it('Khan Designs revenue → FINANCE, high rarity score', () => {
    const score = calculateImportanceScore(
      obs({ source: 'REVENUE_EVENT', title: 'Khan Designs payment received', related_entities: ['Khan Designs'] }),
      { sourceFrequencyInWindow: 1, entityImportanceScores: [0.85], goalAlignedEntityCount: 1, projectRelatedEntityCount: 1 },
    );
    expect(score.rarity_score).toBeGreaterThan(0.85);
    expect(score.final_score).toBeGreaterThan(0.6);
  });

  it('Chai business planning → BUSINESS/PROJECT classification', () => {
    const r = clf.classify('MANUAL', 'Planning Chai location near LPU campus');
    expect(r.categories).toContain('PROJECT');
  });

  it('Gym session → HEALTH', () => {
    const r = clf.classify('HEALTH_UPDATE', 'Gym: 3 sets bench press, weight 82kg');
    expect(r.primary_category).toBe('HEALTH');
  });

  it('Device activity → low importance (noise)', () => {
    const score = calculateImportanceScore(
      obs({ source: 'DEVICE_ACTIVITY', title: 'Screen unlock' }),
      { sourceFrequencyInWindow: 50, entityImportanceScores: [], goalAlignedEntityCount: 0, projectRelatedEntityCount: 0 },
    );
    expect(score.final_score).toBeLessThan(0.3);
  });

  it('PROJECT_MILESTONE with goal entity → highest score tier', () => {
    const score = calculateImportanceScore(
      obs({ source: 'PROJECT_MILESTONE', title: 'Orin got first 10 paying users', related_entities: ['Orin', 'Revenue Goal'] }),
      { sourceFrequencyInWindow: 1, entityImportanceScores: [0.9, 0.85], goalAlignedEntityCount: 1, projectRelatedEntityCount: 1 },
    );
    expect(score.final_score).toBeGreaterThan(0.7);
  });
});
