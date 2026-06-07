// ============================================================
// ingestion.service.ts
// ============================================================
import type { IngestionRepository } from './ingestion.repository';
import type { ConnectorRegistry }   from './connector.registry';
import type { IngestionNormalizer } from './normalizer';
import type { ObservationService }  from '../observation-engine/observation.service';
import type {
  IngestionSource, IngestionRun, CreateSourceInput, RunResult,
} from './ingestion.types';
import { CreateSourceSchema } from './ingestion.schemas';

const MAX_RETRIES = 3;

export class IngestionService {
  constructor(
    private readonly repo:      IngestionRepository,
    private readonly registry:  ConnectorRegistry,
    private readonly normalizer: IngestionNormalizer,
    private readonly obsService: ObservationService,
  ) {}

  async createSource(userId: string, input: CreateSourceInput): Promise<IngestionSource> {
    const validated = CreateSourceSchema.parse(input);
    return this.repo.createSource(userId, validated as CreateSourceInput);
  }

  async listSources(userId: string): Promise<IngestionSource[]> {
    return this.repo.listSources(userId);
  }

  async getSourceHealth(userId: string): Promise<IngestionSource[]> {
    return this.repo.getSourceHealth(userId);
  }

  async getHistory(userId: string, sourceId: string, limit = 20): Promise<IngestionRun[]> {
    return this.repo.getRunHistory(sourceId, userId, limit);
  }

  async syncSource(userId: string, sourceId: string): Promise<RunResult> {
    const source = await this.repo.getSource(sourceId, userId);
    if (!source) throw new Error(`Source ${sourceId} not found`);
    if (!source.enabled) throw new Error(`Source ${sourceId} is disabled`);

    const run = await this.repo.createRun(sourceId, userId);
    const since = source.last_sync_at ? new Date(source.last_sync_at) : undefined;

    let fetched = 0, ingested = 0, skipped = 0, failed = 0;

    try {
      const connector = this.registry.get(source.source_type);
      if (!connector) throw new Error(`No connector for type: ${source.source_type}`);

      const config = { connector_type: source.source_type, user_id: userId, enabled: true, settings: source.config };
      const items = await connector.ingest(config, since);
      fetched = items.length;

      for (const item of items) {
        try {
          const raw = item.title + '\n' + (item.description ?? '');
          const norm = this.normalizer.normalize(raw, source.source_type);

          const dup = await this.repo.isDuplicate(userId, norm.external_id, norm.content_hash);
          if (dup) {
            await this.repo.saveEvent({
              run_id: run.id, source_id: sourceId, user_id: userId,
              external_id: norm.external_id, content_hash: norm.content_hash,
              raw_content: raw, normalized_content: norm as any,
              source_type: source.source_type, status: 'DUPLICATE', error_message: null,
            });
            skipped++;
            continue;
          }

          await this.obsService.observe({ ...item, user_id: userId });
          await this.repo.saveEvent({
            run_id: run.id, source_id: sourceId, user_id: userId,
            external_id: norm.external_id, content_hash: norm.content_hash,
            raw_content: raw, normalized_content: norm as any,
            source_type: source.source_type, status: 'INGESTED', error_message: null,
          });
          ingested++;
        } catch (itemErr) {
          failed++;
          await this.repo.saveFailure({
            source_id: sourceId, run_id: run.id, user_id: userId,
            error_message: itemErr instanceof Error ? itemErr.message : String(itemErr),
            error_code: null, retry_count: 0, max_retries: MAX_RETRIES,
            next_retry_at: new Date(Date.now() + 5 * 60_000).toISOString(),
            is_dead_letter: false,
          });
        }
      }

      const status = failed > 0 && ingested === 0 ? 'FAILED' : failed > 0 ? 'PARTIAL' : 'SUCCESS';
      const healthDelta = failed > 0 ? -0.1 * failed : 0.05;
      const newHealth = Math.min(1, Math.max(0, source.health_score + healthDelta));

      const finalRun = await this.repo.updateRun(run.id, {
        status, completed_at: new Date().toISOString(),
        records_fetched: fetched, records_ingested: ingested,
        records_skipped: skipped, records_failed: failed,
      });

      await this.repo.updateSource(sourceId, userId, {
        sync_status: 'IDLE', last_sync_at: new Date().toISOString(),
        health_score: newHealth,
        consecutive_failures: failed > 0 ? source.consecutive_failures + 1 : 0,
      });

      return { run: finalRun, records_fetched: fetched, records_ingested: ingested, records_skipped: skipped, records_failed: failed };

    } catch (err) {
      await this.repo.updateRun(run.id, {
        status: 'FAILED', completed_at: new Date().toISOString(),
        records_fetched: fetched, records_ingested: ingested,
        records_skipped: skipped, records_failed: failed,
        error_message: err instanceof Error ? err.message : String(err),
      });
      await this.repo.updateSource(sourceId, userId, {
        sync_status: 'FAILED',
        health_score: Math.max(0, source.health_score - 0.2),
        consecutive_failures: source.consecutive_failures + 1,
      });
      throw err;
    }
  }

  async retryFailures(userId: string): Promise<{ retried: number; dead: number }> {
    const pending = await this.repo.getPendingRetries(userId);
    let retried = 0, dead = 0;

    for (const failure of pending) {
      if (failure.retry_count >= failure.max_retries) {
        await this.repo.updateFailure(failure.id, { is_dead_letter: true });
        dead++;
        continue;
      }
      try {
        await this.syncSource(userId, failure.source_id);
        await this.repo.updateFailure(failure.id, {
          retry_count: failure.retry_count + 1,
          next_retry_at: null,
        });
        retried++;
      } catch {
        const nextRetry = new Date(Date.now() + Math.pow(2, failure.retry_count + 1) * 60_000).toISOString();
        await this.repo.updateFailure(failure.id, {
          retry_count: failure.retry_count + 1,
          next_retry_at: nextRetry,
          is_dead_letter: failure.retry_count + 1 >= failure.max_retries,
        });
        if (failure.retry_count + 1 >= failure.max_retries) dead++;
      }
    }
    return { retried, dead };
  }
}
