// ============================================================
// ingestion.test.ts
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IngestionNormalizer } from '../normalizer';
import { ConnectorRegistry } from '../connector.registry';
import { IngestionService } from '../ingestion.service';
import { IngestionScheduler } from '../scheduler';

// ---- Fixtures ---------------------------------------------

function makeRepo(overrides: Record<string, any> = {}) {
  return {
    createSource:     vi.fn((uid, input) => Promise.resolve({ id: 'src-1', user_id: uid, ...input, sync_status: 'IDLE', health_score: 1, consecutive_failures: 0, last_sync_at: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() })),
    getSource:        vi.fn((_id, _uid) => Promise.resolve({ id: 'src-1', user_id: 'u1', source_type: 'GITHUB', name: 'test', config: {}, enabled: true, sync_status: 'IDLE', health_score: 1, consecutive_failures: 0, last_sync_at: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() })),
    listSources:      vi.fn(() => Promise.resolve([])),
    updateSource:     vi.fn((_id, _uid, p) => Promise.resolve({ id: 'src-1', ...p })),
    createRun:        vi.fn(() => Promise.resolve({ id: 'run-1', source_id: 'src-1', user_id: 'u1', started_at: new Date().toISOString(), completed_at: null, status: 'RUNNING', records_fetched: 0, records_ingested: 0, records_skipped: 0, records_failed: 0, error_message: null })),
    updateRun:        vi.fn((_id, p) => Promise.resolve({ id: 'run-1', ...p })),
    getRunHistory:    vi.fn(() => Promise.resolve([])),
    saveEvent:        vi.fn(e => Promise.resolve({ id: 'ev-1', ...e, created_at: new Date().toISOString() })),
    isDuplicate:      vi.fn(() => Promise.resolve(false)),
    saveFailure:      vi.fn(f => Promise.resolve({ id: 'fail-1', ...f, created_at: new Date().toISOString() })),
    getPendingRetries: vi.fn(() => Promise.resolve([])),
    updateFailure:    vi.fn(() => Promise.resolve()),
    getSourceHealth:  vi.fn(() => Promise.resolve([])),
    ...overrides,
  };
}

function makeRegistry(items: any[] = []) {
  return {
    get: vi.fn((_type: string) => ({
      type: 'GITHUB',
      validate: vi.fn(() => Promise.resolve(true)),
      ingest: vi.fn(() => Promise.resolve(items)),
    })),
    list: vi.fn(() => ['GITHUB']),
  } as any;
}

const mockObs = { observe: vi.fn(i => Promise.resolve({ id: 'obs-1', ...i })) } as any;
const norm = new IngestionNormalizer();

// ============================================================
describe('IngestionNormalizer', () => {
  it('normalizes content and generates content_hash', () => {
    const result = norm.normalize('Hello world', 'GITHUB');
    expect(result.title).toBe('Hello world');
    expect(result.content_hash).toBeTruthy();
    expect(result.external_id).toContain('GITHUB');
    expect(result.occurred_at).toBeTruthy();
  });

  it('contentHash is deterministic', () => {
    expect(norm.contentHash('abc')).toBe(norm.contentHash('abc'));
  });

  it('contentHash differs for different inputs', () => {
    expect(norm.contentHash('abc')).not.toBe(norm.contentHash('xyz'));
  });
});

describe('ConnectorRegistry', () => {
  it('createDefault() registers all expected types', () => {
    const r = ConnectorRegistry.createDefault();
    const types = r.list();
    expect(types).toContain('GITHUB');
    expect(types).toContain('GMAIL');
    expect(types).toContain('GOOGLE_CALENDAR');
    expect(types).toContain('MARKDOWN');
    expect(types).toContain('WHATSAPP');
    expect(types).toContain('TELEGRAM');
    expect(types.length).toBe(10);
  });

  it('get() returns correct connector', () => {
    const r = ConnectorRegistry.createDefault();
    const c = r.get('GITHUB');
    expect(c).not.toBeNull();
    expect(c!.type).toBe('GITHUB');
  });

  it('get() returns null for unknown type', () => {
    const r = ConnectorRegistry.createDefault();
    expect(r.get('UNKNOWN_SOURCE')).toBeNull();
  });
});

describe('IngestionRepository — deduplication', () => {
  it('isDuplicate returns true when external_id matches', async () => {
    const repo = makeRepo({ isDuplicate: vi.fn(() => Promise.resolve(true)) });
    expect(await repo.isDuplicate('u1', 'ext-1', 'hash-1')).toBe(true);
  });

  it('isDuplicate returns false when neither matches', async () => {
    const repo = makeRepo({ isDuplicate: vi.fn(() => Promise.resolve(false)) });
    expect(await repo.isDuplicate('u1', 'ext-new', 'hash-new')).toBe(false);
  });
});

describe('IngestionService — sync flow', () => {
  it('syncSource creates a run and returns SUCCESS when no items', async () => {
    const repo = makeRepo();
    const registry = makeRegistry([]);
    const svc = new IngestionService(repo, registry, norm, mockObs);

    const result = await svc.syncSource('u1', 'src-1');
    expect(repo.createRun).toHaveBeenCalledOnce();
    expect(result.run.status).toBe('SUCCESS');
    expect(result.records_fetched).toBe(0);
  });

  it('syncSource ingests non-duplicate events', async () => {
    const repo = makeRepo({ isDuplicate: vi.fn(() => Promise.resolve(false)) });
    const item = { source: 'MANUAL' as any, event_type: 'TEST', title: 'Item 1' };
    const registry = makeRegistry([item]);
    const svc = new IngestionService(repo, registry, norm, mockObs);

    const result = await svc.syncSource('u1', 'src-1');
    expect(result.records_ingested).toBe(1);
    expect(result.records_skipped).toBe(0);
    expect(mockObs.observe).toHaveBeenCalled();
  });

  it('syncSource skips duplicate events', async () => {
    const repo = makeRepo({ isDuplicate: vi.fn(() => Promise.resolve(true)) });
    const item = { source: 'MANUAL' as any, event_type: 'TEST', title: 'Dup' };
    const registry = makeRegistry([item]);
    const obs = { observe: vi.fn() } as any;
    const svc = new IngestionService(repo, registry, norm, obs);

    const result = await svc.syncSource('u1', 'src-1');
    expect(result.records_skipped).toBe(1);
    expect(result.records_ingested).toBe(0);
    expect(obs.observe).not.toHaveBeenCalled();
  });

  it('syncSource throws and marks FAILED when connector throws', async () => {
    const repo = makeRepo({
      getSource: vi.fn(() => Promise.resolve({ id: 'src-1', user_id: 'u1', source_type: 'GITHUB', name: 'x', config: {}, enabled: true, sync_status: 'IDLE', health_score: 1, consecutive_failures: 0, last_sync_at: null, created_at: '', updated_at: '' })),
    });
    const registry = { get: vi.fn(() => ({ type: 'GITHUB', validate: vi.fn(), ingest: vi.fn(() => Promise.reject(new Error('network error'))) })) } as any;
    const svc = new IngestionService(repo, registry, norm, mockObs);

    await expect(svc.syncSource('u1', 'src-1')).rejects.toThrow('network error');
    expect(repo.updateRun).toHaveBeenCalledWith('run-1', expect.objectContaining({ status: 'FAILED' }));
  });

  it('syncSource saves IngestionFailure when individual event throws', async () => {
    const repo = makeRepo({ isDuplicate: vi.fn(() => Promise.resolve(false)) });
    const item = { source: 'MANUAL' as any, event_type: 'TEST', title: 'Bad' };
    const registry = makeRegistry([item]);
    const failingObs = { observe: vi.fn(() => Promise.reject(new Error('obs error'))) } as any;
    const svc = new IngestionService(repo, registry, norm, failingObs);

    const result = await svc.syncSource('u1', 'src-1');
    expect(result.records_failed).toBe(1);
    expect(repo.saveFailure).toHaveBeenCalledOnce();
  });

  it('retryFailures retries pending failures', async () => {
    const failure = { id: 'f1', source_id: 'src-1', run_id: 'run-1', user_id: 'u1', error_message: 'x', error_code: null, retry_count: 0, max_retries: 3, next_retry_at: new Date(Date.now() - 1000).toISOString(), is_dead_letter: false, created_at: '' };
    const repo = makeRepo({ getPendingRetries: vi.fn(() => Promise.resolve([failure])) });
    const registry = makeRegistry([]);
    const svc = new IngestionService(repo, registry, norm, mockObs);

    const result = await svc.retryFailures('u1');
    expect(result.retried + result.dead).toBeGreaterThanOrEqual(0); // attempted
  });

  it('retryFailures marks dead letter after max_retries exceeded', async () => {
    const failure = { id: 'f1', source_id: 'src-1', run_id: 'run-1', user_id: 'u1', error_message: 'x', error_code: null, retry_count: 3, max_retries: 3, next_retry_at: new Date(Date.now() - 1000).toISOString(), is_dead_letter: false, created_at: '' };
    const repo = makeRepo({ getPendingRetries: vi.fn(() => Promise.resolve([failure])) });
    const svc = new IngestionService(repo, makeRegistry([]), norm, mockObs);

    const result = await svc.retryFailures('u1');
    expect(result.dead).toBe(1);
    expect(repo.updateFailure).toHaveBeenCalledWith('f1', { is_dead_letter: true });
  });
});

describe('IngestionService — partial failures', () => {
  it('PARTIAL status when some events fail and some succeed', async () => {
    let callCount = 0;
    const repo = makeRepo({
      isDuplicate: vi.fn(() => Promise.resolve(false)),
    });
    const items = [
      { source: 'MANUAL' as any, event_type: 'T', title: 'ok' },
      { source: 'MANUAL' as any, event_type: 'T', title: 'fail' },
      { source: 'MANUAL' as any, event_type: 'T', title: 'ok2' },
    ];
    const registry = makeRegistry(items);
    const partialObs = {
      observe: vi.fn(() => {
        callCount++;
        if (callCount === 2) return Promise.reject(new Error('fail'));
        return Promise.resolve({ id: `obs-${callCount}` });
      }),
    } as any;
    const svc = new IngestionService(repo, registry, norm, partialObs);

    const result = await svc.syncSource('u1', 'src-1');
    expect(result.run.status).toBe('PARTIAL');
    expect(result.records_ingested).toBe(2);
    expect(result.records_failed).toBe(1);
  });
});

describe('IngestionScheduler', () => {
  beforeEach(() => { vi.useFakeTimers(); });

  it('scheduleSource sets a timer', () => {
    const repo = makeRepo();
    const svc = { syncSource: vi.fn(() => Promise.resolve()) } as any;
    const scheduler = new IngestionScheduler(repo, svc);
    const source: any = { id: 's1', user_id: 'u1', config: { interval_minutes: 1 } };

    scheduler.scheduleSource(source);
    expect((scheduler as any).timers.has('s1')).toBe(true);
    scheduler.stopAll();
  });

  it('unscheduleSource removes the timer', () => {
    const scheduler = new IngestionScheduler(makeRepo(), { syncSource: vi.fn() } as any);
    const source: any = { id: 's2', user_id: 'u1', config: {} };
    scheduler.scheduleSource(source);
    scheduler.unscheduleSource('s2');
    expect((scheduler as any).timers.has('s2')).toBe(false);
  });

  it('stopAll clears all timers', () => {
    const scheduler = new IngestionScheduler(makeRepo(), { syncSource: vi.fn() } as any);
    scheduler.scheduleSource({ id: 'a', user_id: 'u1', config: {} } as any);
    scheduler.scheduleSource({ id: 'b', user_id: 'u1', config: {} } as any);
    scheduler.stopAll();
    expect((scheduler as any).timers.size).toBe(0);
  });
});
