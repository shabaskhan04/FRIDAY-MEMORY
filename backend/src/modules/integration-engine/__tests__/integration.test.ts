// ============================================================
// integration.test.ts — Integration Layer test suite (30+ tests)
// Run: npx vitest run integration.test.ts
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventBus }            from '../event-bus';
import { FailureHandler }      from '../failure-handler';
import { LifecycleManager }    from '../lifecycle.manager';
import { WorkflowEngine,
  observationIngestionWorkflow,
  decisionEvaluationWorkflow,
  weeklyReviewWorkflow,
  graphUpdateWorkflow }        from '../workflow.engine';
import { PipelineEngine }      from '../pipeline.engine';
import { OrchestrationEngine } from '../orchestration.engine';
import { IntegrationMetrics }  from '../integration.metrics';
import { IntegrationInsights } from '../integration-insights';
import type {
  StageDefinition, PipelineRun, PipelineStage, IntegrationEvent,
} from '../integration.types';

// ============================================================
// Shared helpers
// ============================================================

const UID = 'user-1';

function makeStage(name: string, fn?: (input: any) => Promise<any>): StageDefinition {
  return { name, fn: fn ?? (async (input: Record<string, unknown>) => ({ ...input, [`${name}_done`]: true })) };
}

function makeFailingStage(name: string, recoverable = true, maxRetries = 1): StageDefinition {
  return { name, recoverable, maxRetries, fn: async () => { throw new Error(`${name} failed`); } };
}

function makeNonRecoverableStage(name: string): StageDefinition {
  return { name, recoverable: false, maxRetries: 0, fn: async () => { throw new Error(`hard fail`); } };
}

function makeRepo(runsStore: PipelineRun[] = [], stagesStore: PipelineStage[] = []) {
  let rc = 0, sc = 0;
  return {
    createRun: vi.fn((input: any) => {
      const r = { id: `run-${++rc}`, started_at: new Date().toISOString(), completed_at: null, duration_ms: null, ...input };
      runsStore.push(r); return Promise.resolve(r);
    }),
    updateRun: vi.fn((id: string, patch: any) => {
      const r = runsStore.find(r => r.id === id); if (r) Object.assign(r, patch);
      return Promise.resolve();
    }),
    getRunById:        vi.fn((id: string) => Promise.resolve(runsStore.find(r => r.id === id) ?? null)),
    listRuns:          vi.fn(() => Promise.resolve([...runsStore])),
    listRunsByWorkflow: vi.fn((u: string, wf: string) => Promise.resolve(runsStore.filter(r => r.workflow_type === wf))),
    listRunsByStatus:  vi.fn((u: string, s: string)  => Promise.resolve(runsStore.filter(r => r.status === s))),
    createStage: vi.fn((input: any) => {
      const s = { id: `stage-${++sc}`, started_at: new Date().toISOString(), completed_at: null, duration_ms: null, error: null, metadata: {}, ...input };
      stagesStore.push(s); return Promise.resolve(s);
    }),
    updateStage: vi.fn((id: string, patch: any) => {
      const s = stagesStore.find(s => s.id === id); if (s) Object.assign(s, patch);
      return Promise.resolve();
    }),
    getStagesByRun:  vi.fn((runId: string) => Promise.resolve(stagesStore.filter(s => s.pipeline_run_id === runId))),
    getFailedStages: vi.fn(() => Promise.resolve(stagesStore.filter(s => s.status === 'FAILED'))),
  } as any;
}

function buildPipeline(repo?: any) {
  const r   = repo ?? makeRepo();
  const lc  = new LifecycleManager(r);
  const fh  = new FailureHandler();
  const bus = new EventBus();
  return { repo: r, lifecycle: lc, failures: fh, bus, engine: new PipelineEngine(lc, fh, bus) };
}

// ============================================================
// 1. Event Bus
// ============================================================

describe('EventBus', () => {
  it('delivers event to subscriber', async () => {
    const bus = new EventBus();
    const got: IntegrationEvent[] = [];
    bus.subscribe('OBSERVATION_CREATED', e => { got.push(e); });
    await bus.publish({ type: 'OBSERVATION_CREATED', user_id: UID, payload: { id: 'obs-1' }, emitted_at: '' });
    expect(got[0].payload).toEqual({ id: 'obs-1' });
  });

  it('delivers to multiple subscribers', async () => {
    const bus = new EventBus();
    let count = 0;
    bus.subscribe('ACTIVITY_CREATED', () => { count++; });
    bus.subscribe('ACTIVITY_CREATED', () => { count++; });
    await bus.publish({ type: 'ACTIVITY_CREATED', user_id: UID, payload: {}, emitted_at: '' });
    expect(count).toBe(2);
  });

  it('unsubscribe stops delivery', async () => {
    const bus = new EventBus();
    let count = 0;
    const unsub = bus.subscribe('GRAPH_UPDATED', () => { count++; });
    unsub();
    await bus.publish({ type: 'GRAPH_UPDATED', user_id: UID, payload: {}, emitted_at: '' });
    expect(count).toBe(0);
  });

  it('one failing handler does not block others', async () => {
    const bus = new EventBus();
    let second = false;
    bus.subscribe('DECISION_CREATED', async () => { throw new Error('boom'); });
    bus.subscribe('DECISION_CREATED', () => { second = true; });
    await bus.publish({ type: 'DECISION_CREATED', user_id: UID, payload: {}, emitted_at: '' });
    expect(second).toBe(true);
  });

  it('subscriberCount is accurate', () => {
    const bus = new EventBus();
    bus.subscribe('PIPELINE_COMPLETED', () => {});
    bus.subscribe('PIPELINE_COMPLETED', () => {});
    expect(bus.subscriberCount('PIPELINE_COMPLETED')).toBe(2);
  });

  it('clear removes all handlers', async () => {
    const bus = new EventBus();
    let called = false;
    bus.subscribe('PIPELINE_FAILED', () => { called = true; });
    bus.clear();
    await bus.publish({ type: 'PIPELINE_FAILED', user_id: UID, payload: {}, emitted_at: '' });
    expect(called).toBe(false);
  });

  it('emit is sync fire-and-forget', () => {
    const bus = new EventBus();
    let called = false;
    bus.subscribe('CAUSAL_LINK_CREATED', () => { called = true; });
    bus.emit('CAUSAL_LINK_CREATED', UID, { edge: 'e1' });
    expect(called).toBe(true);
  });
});

// ============================================================
// 2. Failure Handler + retry
// ============================================================

describe('FailureHandler', () => {
  const ctx = { run_id: 'run-1', user_id: UID, workflow: 'OBSERVATION_INGESTION' as const };

  it('returns result on success with 0 retries', async () => {
    const fh = new FailureHandler();
    const [out, err, retries] = await fh.execute(makeStage('s1'), { x: 1 }, ctx);
    expect(out).toMatchObject({ x: 1, s1_done: true });
    expect(err).toBeNull();
    expect(retries).toBe(0);
  });

  it('retries maxRetries times then returns error', async () => {
    const fh = new FailureHandler();
    let calls = 0;
    const stage: StageDefinition = { name: 'flaky', maxRetries: 2, fn: async () => { calls++; throw new Error('fail'); } };
    const [out, err] = await fh.execute(stage, {}, ctx);
    expect(out).toBeNull();
    expect(err).toBe('fail');
    expect(calls).toBe(3); // 1 attempt + 2 retries
  });

  it('records failure with recoverable flag', async () => {
    const fh = new FailureHandler();
    await fh.execute(makeFailingStage('bad', true), {}, ctx);
    const failures = fh.getFailures('run-1');
    expect(failures[0].stage_name).toBe('bad');
    expect(failures[0].recoverable).toBe(true);
  });

  it('times out and reports error', async () => {
    const fh = new FailureHandler();
    const stage: StageDefinition = {
      name: 'slow', timeoutMs: 10, maxRetries: 0,
      fn: async () => new Promise(r => setTimeout(r, 500)),
    };
    const [, err] = await fh.execute(stage, {}, ctx);
    expect(err).toContain('timed out');
  });
});

// ============================================================
// 3. Observation → Activity workflow
// ============================================================

describe('Observation ingestion workflow', () => {
  it('all stages complete, emits PIPELINE_COMPLETED', async () => {
    const { engine, bus } = buildPipeline();
    let done = false;
    bus.subscribe('PIPELINE_COMPLETED', () => { done = true; });

    const wf = observationIngestionWorkflow([
      makeStage('classify'),
      makeStage('correlate'),
      makeStage('graph-update'),
    ]);
    const { results } = await engine.run(wf, UID, { obs_id: 'obs-orin' });
    expect(results.every(r => r.status === 'COMPLETED')).toBe(true);
    expect(done).toBe(true);
  });

  it('passes stage output as next input', async () => {
    const { engine } = buildPipeline();
    let received: any;
    const wf = observationIngestionWorkflow([
      { name: 's1', fn: async () => ({ entity: 'Orin' }) },
      { name: 's2', fn: async input => { received = input; return input; } },
    ]);
    await engine.run(wf, UID, {});
    expect(received.entity).toBe('Orin');
  });

  it('recoverable failure is SKIPPED, pipeline continues', async () => {
    const { engine } = buildPipeline();
    const wf = observationIngestionWorkflow([
      makeStage('classify'),
      makeFailingStage('correlate', true),
      makeStage('graph-update'),
    ]);
    const { run, results } = await engine.run(wf, UID, {});
    expect(results[1].status).toBe('SKIPPED');
    expect(results[2].status).toBe('COMPLETED');
    expect(run.status).toBe('COMPLETED');
  });

  it('non-recoverable failure halts pipeline, emits PIPELINE_FAILED', async () => {
    const { engine, bus } = buildPipeline();
    let failed = false;
    bus.subscribe('PIPELINE_FAILED', () => { failed = true; });
    const wf = observationIngestionWorkflow([
      makeStage('classify'),
      makeNonRecoverableStage('graph-update'),
      makeStage('review-trigger'),   // must not execute
    ]);
    const { run, results } = await engine.run(wf, UID, {});
    expect(run.status).toBe('FAILED');
    expect(results.find(r => r.stage_name === 'review-trigger')).toBeUndefined();
    expect(failed).toBe(true);
  });
});

// ============================================================
// 4. Activity → Graph workflow (Khan Designs scenario)
// ============================================================

describe('Activity to graph workflow', () => {
  it('Khan Designs activity propagates to graph stages', async () => {
    const { engine } = buildPipeline();
    const wf = observationIngestionWorkflow([
      { name: 'correlate', fn: async () => ({ activity: 'Khan Designs client call', entities: ['Khan Designs'] }) },
      makeStage('graph-upsert'),
      makeStage('edge-update'),
    ]);
    const { results } = await engine.run(wf, UID, { obs_id: 'obs-khan' });
    expect(results.every(r => r.status === 'COMPLETED')).toBe(true);
  });
});

// ============================================================
// 5. Decision → Causal workflow
// ============================================================

describe('Decision evaluation workflow', () => {
  it('runs causal-update and review-trigger stages', async () => {
    const { engine } = buildPipeline();
    const wf = decisionEvaluationWorkflow([
      { name: 'decision-eval', fn: async () => ({ decision_id: 'd-orin', success_score: 0.8 }) },
      makeStage('causal-update'),
      makeStage('review-trigger'),
    ]);
    const { run } = await engine.run(wf, UID, { decision_id: 'd-orin' });
    expect(run.status).toBe('COMPLETED');
  });

  it('causal-update failure is isolated, review-trigger still runs', async () => {
    const { engine } = buildPipeline();
    const wf = decisionEvaluationWorkflow([
      makeStage('decision-eval'),
      makeFailingStage('causal-update', true),
      makeStage('review-trigger'),
    ]);
    const { results } = await engine.run(wf, UID, {});
    expect(results[2].status).toBe('COMPLETED');
  });
});

// ============================================================
// 6. Weekly Review workflow
// ============================================================

describe('Weekly review workflow', () => {
  it('snapshot → review → recommendations all complete', async () => {
    const { engine } = buildPipeline();
    const wf = weeklyReviewWorkflow([
      makeStage('snapshot'),
      makeStage('strategic-review'),
      makeStage('recommendations'),
    ]);
    const { results } = await engine.run(wf, UID, { trigger: 'weekly' });
    expect(results.every(r => r.status === 'COMPLETED')).toBe(true);
  });
});

// ============================================================
// 7. Graph Update workflow
// ============================================================

describe('Graph update workflow', () => {
  it('causal re-evaluation and review trigger run after graph update', async () => {
    const { engine, bus } = buildPipeline();
    bus.subscribe('PIPELINE_COMPLETED', () => {});
    const wf = graphUpdateWorkflow([
      makeStage('causal-reeval'),
      makeStage('review-check'),
    ]);
    const { run } = await engine.run(wf, UID, { node_id: 'n-orin' });
    expect(run.status).toBe('COMPLETED');
  });
});

// ============================================================
// 8. Lifecycle tracking
// ============================================================

describe('LifecycleManager', () => {
  it('startRun creates RUNNING run', async () => {
    const { repo, lifecycle } = buildPipeline();
    const run = await lifecycle.startRun(UID, 'OBSERVATION_INGESTION');
    expect(run.status).toBe('RUNNING');
  });

  it('completeRun persists COMPLETED status', async () => {
    const { repo, lifecycle } = buildPipeline();
    const run = await lifecycle.startRun(UID, 'WEEKLY_REVIEW');
    await lifecycle.completeRun(run.id, 'COMPLETED');
    expect(repo.updateRun).toHaveBeenCalledWith(run.id, expect.objectContaining({ status: 'COMPLETED' }));
  });

  it('stage records duration and error on FAILED', async () => {
    const { repo, lifecycle } = buildPipeline();
    const stage = await lifecycle.startStage('run-1', 'graph-update');
    await lifecycle.completeStage(stage.id, 'FAILED', 10, 'DB timeout');
    expect(repo.updateStage).toHaveBeenCalledWith(stage.id,
      expect.objectContaining({ status: 'FAILED', duration_ms: 10, error: 'DB timeout' }));
  });

  it('pipeline run stages are queryable', async () => {
    const { engine, lifecycle } = buildPipeline();
    const wf = observationIngestionWorkflow([makeStage('s1'), makeStage('s2')]);
    const { run } = await engine.run(wf, UID, {});
    const stages = await lifecycle.getStages(run.id);
    expect(stages.length).toBeGreaterThanOrEqual(2);
  });
});

// ============================================================
// 9. Metrics
// ============================================================

describe('IntegrationMetrics', () => {
  it('success_rate = 1 when all completed', async () => {
    const runs: PipelineRun[] = [
      { id: 'r1', user_id: UID, workflow_type: 'OBSERVATION_INGESTION', status: 'COMPLETED', started_at: '', completed_at: '', duration_ms: 100, metadata: {} },
      { id: 'r2', user_id: UID, workflow_type: 'WEEKLY_REVIEW',         status: 'COMPLETED', started_at: '', completed_at: '', duration_ms: 200, metadata: {} },
    ];
    const m = new IntegrationMetrics(makeRepo(runs));
    const r = await m.getPipelineMetrics(UID);
    expect(r.success_rate).toBe(1.0);
    expect(r.total_runs).toBe(2);
  });

  it('failure_rate = 0.5 with one failed run', async () => {
    const runs: PipelineRun[] = [
      { id: 'r1', user_id: UID, workflow_type: 'GRAPH_UPDATE', status: 'COMPLETED', started_at: '', completed_at: '', duration_ms: 50,  metadata: {} },
      { id: 'r2', user_id: UID, workflow_type: 'GRAPH_UPDATE', status: 'FAILED',    started_at: '', completed_at: '', duration_ms: 10,  metadata: {} },
    ];
    const m = new IntegrationMetrics(makeRepo(runs));
    const r = await m.getPipelineMetrics(UID);
    expect(r.failure_rate).toBe(0.5);
  });

  it('getWorkflowMetrics groups correctly', async () => {
    const runs: PipelineRun[] = [
      { id: 'r1', user_id: UID, workflow_type: 'OBSERVATION_INGESTION', status: 'COMPLETED', started_at: '', completed_at: '', duration_ms: 100, metadata: {} },
      { id: 'r2', user_id: UID, workflow_type: 'OBSERVATION_INGESTION', status: 'FAILED',    started_at: '', completed_at: '', duration_ms: 50,  metadata: {} },
      { id: 'r3', user_id: UID, workflow_type: 'WEEKLY_REVIEW',         status: 'COMPLETED', started_at: '', completed_at: '', duration_ms: 300, metadata: {} },
    ];
    const m   = new IntegrationMetrics(makeRepo(runs));
    const wms = await m.getWorkflowMetrics(UID);
    const obs = wms.find(w => w.workflow_type === 'OBSERVATION_INGESTION');
    expect(obs?.run_count).toBe(2);
    expect(obs?.success_rate).toBe(0.5);
  });

  it('returns zeros when no runs', async () => {
    const m = new IntegrationMetrics(makeRepo([]));
    const r = await m.getPipelineMetrics(UID);
    expect(r.total_runs).toBe(0);
    expect(r.success_rate).toBe(0);
  });
});

// ============================================================
// 10. Insights
// ============================================================

describe('IntegrationInsights', () => {
  it('HEALTHY when all recent runs succeed', async () => {
    const runs = Array.from({ length: 10 }, (_, i) => ({
      id: `r${i}`, user_id: UID, workflow_type: 'OBSERVATION_INGESTION' as const,
      status: 'COMPLETED' as const, started_at: '', completed_at: '', duration_ms: 100, metadata: {},
    }));
    const ins  = new IntegrationInsights(makeRepo(runs));
    const h    = await ins.getPipelineHealth(UID);
    expect(h.status).toBe('HEALTHY');
  });

  it('CRITICAL when > 40% of recent runs fail', async () => {
    const runs = Array.from({ length: 10 }, (_, i) => ({
      id: `r${i}`, user_id: UID, workflow_type: 'GRAPH_UPDATE' as const,
      status: (i < 3 ? 'COMPLETED' : 'FAILED') as any,
      started_at: '', completed_at: '', duration_ms: 100, metadata: {},
    }));
    const ins = new IntegrationInsights(makeRepo(runs));
    const h   = await ins.getPipelineHealth(UID);
    expect(h.status).toBe('CRITICAL');
  });

  it('getBottlenecks returns slowest stage first', async () => {
    const runs: PipelineRun[] = [
      { id: 'r1', user_id: UID, workflow_type: 'WEEKLY_REVIEW', status: 'COMPLETED', started_at: '', completed_at: '', duration_ms: 1000, metadata: {} },
    ];
    const stages: PipelineStage[] = [
      { id: 's1', pipeline_run_id: 'r1', stage_name: 'snapshot', status: 'COMPLETED', started_at: '', completed_at: '', duration_ms: 800, error: null, metadata: {} },
      { id: 's2', pipeline_run_id: 'r1', stage_name: 'review',   status: 'COMPLETED', started_at: '', completed_at: '', duration_ms: 200, error: null, metadata: {} },
    ];
    const ins = new IntegrationInsights(makeRepo(runs, stages));
    const bns = await ins.getBottlenecks(UID, 5);
    expect(bns[0].stage_name).toBe('snapshot');
  });

  it('getFailurePatterns aggregates failed stage errors', async () => {
    const runs: PipelineRun[] = [
      { id: 'r1', user_id: UID, workflow_type: 'OBSERVATION_INGESTION', status: 'FAILED', started_at: '', completed_at: '', duration_ms: 50, metadata: {} },
    ];
    const stages: PipelineStage[] = [
      { id: 's1', pipeline_run_id: 'r1', stage_name: 'graph-update', status: 'FAILED', started_at: '', completed_at: '', duration_ms: 50, error: 'DB timeout', metadata: {} },
    ];
    const ins      = new IntegrationInsights(makeRepo(runs, stages));
    const patterns = await ins.getFailurePatterns(UID);
    expect(patterns[0].stage_name).toBe('graph-update');
    expect(patterns[0].sample_errors).toContain('DB timeout');
  });
});

// ============================================================
// 11. Orchestration Engine
// ============================================================

describe('OrchestrationEngine', () => {
  function setup(stages: StageDefinition[] = [makeStage('default')]) {
    const { engine, bus } = buildPipeline();
    const wfEngine = new WorkflowEngine();
    wfEngine.register(observationIngestionWorkflow(stages));
    wfEngine.register(decisionEvaluationWorkflow(stages));
    wfEngine.register(weeklyReviewWorkflow(stages));
    wfEngine.register(graphUpdateWorkflow(stages));
    return { orch: new OrchestrationEngine(engine, wfEngine, bus), bus };
  }

  it('processObservation emits OBSERVATION_CREATED', async () => {
    const { orch, bus } = setup();
    let fired = false;
    bus.subscribe('OBSERVATION_CREATED', () => { fired = true; });
    await orch.processObservation(UID, { title: 'Worked on Orin' });
    expect(fired).toBe(true);
  });

  it('processDecision emits DECISION_EVALUATED', async () => {
    const { orch, bus } = setup();
    let fired = false;
    bus.subscribe('DECISION_EVALUATED', () => { fired = true; });
    await orch.processDecision(UID, { decision_id: 'd-khan' });
    expect(fired).toBe(true);
  });

  it('processWeeklyReview emits STRATEGIC_REVIEW_CREATED', async () => {
    const { orch, bus } = setup();
    let fired = false;
    bus.subscribe('STRATEGIC_REVIEW_CREATED', () => { fired = true; });
    await orch.processWeeklyReview(UID);
    expect(fired).toBe(true);
  });

  it('processGraphUpdate emits GRAPH_UPDATED', async () => {
    const { orch, bus } = setup();
    let fired = false;
    bus.subscribe('GRAPH_UPDATED', () => { fired = true; });
    await orch.processGraphUpdate(UID, { node_id: 'n-orin' });
    expect(fired).toBe(true);
  });

  it('throws when workflow not registered', async () => {
    const { engine, bus } = buildPipeline();
    const orch = new OrchestrationEngine(engine, new WorkflowEngine(), bus);
    await expect(orch.processObservation(UID, {})).rejects.toThrow('not registered');
  });
});
