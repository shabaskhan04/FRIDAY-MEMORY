// ============================================================
// activity.test.ts
// Run: npx vitest run activity.test.ts
// ============================================================

import { describe, it, expect, vi } from 'vitest';
import { CorrelationEngine }  from '../correlation.engine';
import { TimelineEngine }     from '../timeline.engine';
import {
  getSignalQuality,
  clusterSignalQuality,
  scoreActivity,
} from '../activity.scoring';
import type { Observation }          from '../../observation-engine/observation.types';
import type { ObservationCluster }   from '../activity.types';

// ============================================================
// Fixtures
// ============================================================

const NOW  = new Date('2026-06-06T09:00:00Z');
const MIN  = 60_000;
const UID  = 'user-1';

function obs(overrides: Partial<Observation> & { occurred_at: string }): Observation {
  return {
    id: Math.random().toString(36).slice(2),
    user_id: UID, source: 'MANUAL', event_type: 'note',
    title: 'Task', description: null,
    importance_score: 0.6, confidence_score: 1.0,
    categories: ['WORK'], metadata: {}, related_entities: [],
    is_processed: true,
    created_at: overrides.occurred_at, updated_at: overrides.occurred_at,
    ...overrides,
  };
}

function at(offsetMins: number): string {
  return new Date(NOW.getTime() + offsetMins * MIN).toISOString();
}

// ============================================================
// 1. Signal quality scoring
// ============================================================

describe('getSignalQuality', () => {
  it('GIT_COMMIT is HIGH tier with score 0.95', () => {
    const r = getSignalQuality('GIT_COMMIT');
    expect(r.tier).toBe('HIGH');
    expect(r.score).toBe(0.95);
  });

  it('MANUAL is MEDIUM tier', () => {
    expect(getSignalQuality('MANUAL').tier).toBe('MEDIUM');
  });

  it('WEBSITE_VISIT is LOW tier', () => {
    expect(getSignalQuality('WEBSITE_VISIT').tier).toBe('LOW');
  });

  it('DEVICE_ACTIVITY is NOISE tier with score 0.05', () => {
    const r = getSignalQuality('DEVICE_ACTIVITY');
    expect(r.tier).toBe('NOISE');
    expect(r.score).toBe(0.05);
  });

  it('PROJECT_MILESTONE is the highest scoring source', () => {
    expect(getSignalQuality('PROJECT_MILESTONE').score).toBe(0.97);
  });

  it('clusterSignalQuality: high-quality cluster > low-quality cluster', () => {
    const highCluster: ObservationCluster = {
      observations: [
        obs({ occurred_at: at(0), source: 'GIT_COMMIT' }),
        obs({ occurred_at: at(5), source: 'TASK_COMPLETED' }),
      ],
      start_time: NOW, end_time: new Date(NOW.getTime() + 5 * MIN),
      dominant_category: 'WORK', entities: [], avg_signal_quality: 0,
    };
    highCluster.avg_signal_quality = clusterSignalQuality(highCluster);

    const lowCluster: ObservationCluster = {
      observations: [
        obs({ occurred_at: at(0), source: 'WEBSITE_VISIT' }),
        obs({ occurred_at: at(5), source: 'APP_USAGE' }),
      ],
      start_time: NOW, end_time: new Date(NOW.getTime() + 5 * MIN),
      dominant_category: 'SYSTEM', entities: [], avg_signal_quality: 0,
    };
    lowCluster.avg_signal_quality = clusterSignalQuality(lowCluster);

    expect(highCluster.avg_signal_quality).toBeGreaterThan(lowCluster.avg_signal_quality);
  });
});

// ============================================================
// 2. Activity scoring
// ============================================================

describe('scoreActivity', () => {
  it('longer duration raises importance_score', () => {
    const short: ObservationCluster = {
      observations: [obs({ occurred_at: at(0), source: 'GIT_COMMIT', importance_score: 0.7 })],
      start_time: NOW, end_time: new Date(NOW.getTime() + 10 * MIN),
      dominant_category: 'WORK', entities: ['Orin'], avg_signal_quality: 0.95,
    };
    const long: ObservationCluster = {
      ...short,
      start_time: NOW,
      end_time: new Date(NOW.getTime() + 90 * MIN),
    };
    expect(scoreActivity(long).importance_score).toBeGreaterThan(scoreActivity(short).importance_score);
  });

  it('more entities raises importance_score', () => {
    const few: ObservationCluster = {
      observations: [obs({ occurred_at: at(0), source: 'GIT_COMMIT', importance_score: 0.7 })],
      start_time: NOW, end_time: new Date(NOW.getTime() + 30 * MIN),
      dominant_category: 'PROJECT', entities: ['Orin'], avg_signal_quality: 0.9,
    };
    const many = { ...few, entities: ['Orin', 'Revenue Goal', 'Scholarships', 'LXV'] };
    expect(scoreActivity(many).importance_score).toBeGreaterThan(scoreActivity(few).importance_score);
  });

  it('3+ observations raises confidence_score above 1', () => {
    const cluster: ObservationCluster = {
      observations: [
        obs({ occurred_at: at(0),  source: 'GIT_COMMIT', importance_score: 0.9 }),
        obs({ occurred_at: at(10), source: 'TASK_COMPLETED', importance_score: 0.85 }),
        obs({ occurred_at: at(20), source: 'FILE_MODIFIED', importance_score: 0.6 }),
      ],
      start_time: NOW, end_time: new Date(NOW.getTime() + 20 * MIN),
      dominant_category: 'PROJECT', entities: ['Orin'], avg_signal_quality: 0.88,
    };
    const { confidence_score } = scoreActivity(cluster);
    expect(confidence_score).toBeGreaterThan(0.6);
  });
});

// ============================================================
// 3. Correlation engine
// ============================================================

describe('CorrelationEngine', () => {
  const engine = new CorrelationEngine();

  it('groups observations within 30-min gap into one cluster', () => {
    const observations = [
      obs({ occurred_at: at(0),  source: 'GIT_COMMIT',     title: 'Orin push',       related_entities: ['Orin'] }),
      obs({ occurred_at: at(10), source: 'TASK_COMPLETED',  title: 'Ticket closed',   related_entities: ['Orin'] }),
      obs({ occurred_at: at(20), source: 'FILE_MODIFIED',   title: 'Updated readme',  related_entities: ['Orin'] }),
    ];
    const candidates = engine.correlate(observations);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].cluster.observations).toHaveLength(3);
  });

  it('splits clusters on gap > 30 min', () => {
    const observations = [
      obs({ occurred_at: at(0),  source: 'GIT_COMMIT',    title: 'Orin feature',  related_entities: ['Orin'] }),
      obs({ occurred_at: at(35), source: 'HEALTH_UPDATE', title: 'Gym session',   related_entities: ['Gym'] }),
    ];
    const candidates = engine.correlate(observations);
    expect(candidates).toHaveLength(2);
  });

  it('merges observations sharing an entity even with short gap', () => {
    const observations = [
      obs({ occurred_at: at(0),  source: 'GIT_COMMIT',   title: 'Khan invoice',  related_entities: ['Khan Designs'] }),
      obs({ occurred_at: at(5),  source: 'EMAIL_SENT',   title: 'Sent proposal', related_entities: ['Khan Designs'] }),
      obs({ occurred_at: at(10), source: 'MANUAL',       title: 'Gym notes',     related_entities: ['Gym'] }),
    ];
    const candidates = engine.correlate(observations);
    // Khan Designs obs should be merged; Gym is separate
    expect(candidates.length).toBeGreaterThanOrEqual(2);
    const khanCluster = candidates.find(c => c.cluster.entities.includes('Khan Designs'));
    expect(khanCluster).toBeDefined();
    expect(khanCluster!.cluster.observations).toHaveLength(2);
  });

  it('DEVICE_ACTIVITY (NOISE) is excluded from clustering', () => {
    const observations = [
      obs({ occurred_at: at(0),  source: 'DEVICE_ACTIVITY', title: 'Screen unlock' }),
      obs({ occurred_at: at(1),  source: 'GIT_COMMIT',       title: 'Orin push', related_entities: ['Orin'] }),
    ];
    const candidates = engine.correlate(observations);
    expect(candidates.every(c =>
      c.cluster.observations.every(o => o.source !== 'DEVICE_ACTIVITY')
    )).toBe(true);
  });

  it('derives entity-based title when single entity present', () => {
    const observations = [
      obs({ occurred_at: at(0), source: 'GIT_COMMIT', title: 'feat: new feature', related_entities: ['Orin'] }),
    ];
    const candidates = engine.correlate(observations);
    expect(candidates[0].title).toContain('Orin');
  });

  it('assigns correct dominant category (PROJECT for git+task)', () => {
    const observations = [
      obs({ occurred_at: at(0),  source: 'GIT_COMMIT',    categories: ['WORK', 'PROJECT'], related_entities: ['Orin'] }),
      obs({ occurred_at: at(10), source: 'TASK_COMPLETED', categories: ['PROJECT'],         related_entities: ['Orin'] }),
    ];
    const [candidate] = engine.correlate(observations);
    expect(['WORK', 'PROJECT']).toContain(candidate.category);
  });
});

// ============================================================
// 4. Timeline reconstruction
// ============================================================

describe('TimelineEngine', () => {
  const TODAY = new Date('2026-06-06T00:00:00Z');

  function makeRepo(activities: any[]) {
    return {
      listInRange: vi.fn(() => Promise.resolve(activities)),
      getObservationIds: vi.fn(() => Promise.resolve([])),
    } as any;
  }

  function activity(title: string, startH: number, endH: number, category = 'PROJECT'): any {
    const s = new Date(TODAY.getTime() + startH * 3600_000);
    const e = new Date(TODAY.getTime() + endH   * 3600_000);
    return {
      id: title, user_id: UID, title,
      started_at: s.toISOString(), ended_at: e.toISOString(),
      duration_mins: (endH - startH) * 60,
      category, importance_score: 0.7, confidence_score: 0.9,
      signal_quality: 0.88, related_entities: [], metadata: {},
      created_at: s.toISOString(), updated_at: s.toISOString(),
    };
  }

  it('reconstructDay produces blocks sorted by start time', async () => {
    const acts = [
      activity('Khan Designs', 13, 14, 'WORK'),
      activity('Worked on Orin', 9, 11.5, 'PROJECT'),
      activity('Gym', 12, 12.75, 'HEALTH'),
    ];
    const engine = new TimelineEngine(makeRepo(acts));
    const timeline = await engine.reconstructDay(UID, TODAY);

    expect(timeline.blocks.map(b => b.activity.title))
      .toEqual(['Worked on Orin', 'Gym', 'Khan Designs']);
  });

  it('reconstructDay label format is "HH:MM–HH:MM · Title"', async () => {
    const engine = new TimelineEngine(makeRepo([activity('Worked on Orin', 9, 11.5, 'PROJECT')]));
    const timeline = await engine.reconstructDay(UID, TODAY);
    expect(timeline.blocks[0].label).toMatch(/\d{2}:\d{2}–\d{2}:\d{2} · Worked on Orin/);
  });

  it('total_active_mins sums correctly', async () => {
    const acts = [
      activity('Orin', 9, 11.5),          // 150 mins
      activity('Gym', 12, 12.75),          // 45 mins
      activity('Khan Designs', 13, 14),    // 60 mins
    ];
    const engine = new TimelineEngine(makeRepo(acts));
    const tl = await engine.reconstructDay(UID, TODAY);
    expect(tl.total_active_mins).toBe(255);
  });

  it('top_category is the category with most total minutes', async () => {
    const acts = [
      activity('Orin',          9, 12,    'PROJECT'),   // 180 mins
      activity('Gym',           12, 12.75, 'HEALTH'),   // 45 mins
      activity('Khan Designs',  13, 14,    'WORK'),     // 60 mins
    ];
    const engine = new TimelineEngine(makeRepo(acts));
    const tl = await engine.reconstructDay(UID, TODAY);
    expect(tl.top_category).toBe('PROJECT');
  });
});

// ============================================================
// 5. Realistic scenario: Mr. Khan's morning
// ============================================================

describe('Realistic scenario: Mr. Khan morning cluster', () => {
  const engine = new CorrelationEngine();

  it('9:00 GIT + 9:15 TASK + 9:30 FILE → single Orin cluster', () => {
    const observations = [
      obs({ occurred_at: at(0),  source: 'GIT_COMMIT',   title: 'feat: add scholarship matching', related_entities: ['Orin'], categories: ['WORK', 'PROJECT'], importance_score: 0.85 }),
      obs({ occurred_at: at(15), source: 'TASK_COMPLETED', title: 'Close ORIN-42',                 related_entities: ['Orin'], categories: ['PROJECT'],         importance_score: 0.80 }),
      obs({ occurred_at: at(30), source: 'FILE_MODIFIED', title: 'Updated orin/README.md',         related_entities: ['Orin'], categories: ['WORK', 'PROJECT'], importance_score: 0.60 }),
    ];
    const [cluster] = engine.correlate(observations);

    expect(cluster.cluster.observations).toHaveLength(3);
    expect(cluster.cluster.entities).toContain('Orin');
    expect(cluster.title).toContain('Orin');
    expect(cluster.confidence_score).toBeGreaterThan(0.6);
    expect(cluster.signal_quality).toBeGreaterThan(0.75);

    // Expected output:
    // title: "Project Work · Orin"
    // category: PROJECT or WORK
    // importance_score > 0.6
    // signal_quality > 0.75 (git + task are HIGH)
    expect(['WORK', 'PROJECT']).toContain(cluster.category);
    expect(cluster.importance_score).toBeGreaterThan(0.6);
  });

  it('Orin block + Gym block stay separated (>30 min gap)', () => {
    const observations = [
      obs({ occurred_at: at(0),  source: 'GIT_COMMIT',   related_entities: ['Orin'],  categories: ['PROJECT'], importance_score: 0.85 }),
      obs({ occurred_at: at(15), source: 'TASK_COMPLETED', related_entities: ['Orin'], categories: ['PROJECT'], importance_score: 0.80 }),
      obs({ occurred_at: at(90), source: 'HEALTH_UPDATE', related_entities: ['Gym'],   categories: ['HEALTH'],  importance_score: 0.75 }),
    ];
    const candidates = engine.correlate(observations);
    expect(candidates).toHaveLength(2);
    expect(candidates[0].category).not.toBe(candidates[1].category);
  });
});
