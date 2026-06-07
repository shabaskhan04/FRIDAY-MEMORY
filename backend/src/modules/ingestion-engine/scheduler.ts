// ============================================================
// scheduler.ts — Schedule periodic source syncs
// ============================================================
import type { IngestionService }    from './ingestion.service';
import type { IngestionRepository } from './ingestion.repository';
import type { IngestionSource }     from './ingestion.types';

export class IngestionScheduler {
  private readonly timers = new Map<string, ReturnType<typeof setInterval>>();

  constructor(
    private readonly repo:    IngestionRepository,
    private readonly service: IngestionService,
  ) {}

  scheduleSource(source: IngestionSource): void {
    if (this.timers.has(source.id)) return;
    const intervalMs = ((source.config.interval_minutes as number | undefined) ?? 60) * 60_000;
    const timer = setInterval(() => {
      this.service.syncSource(source.user_id, source.id).catch(err => {
        console.error(`[Scheduler] sync failed for ${source.id}:`, err);
      });
    }, intervalMs);
    this.timers.set(source.id, timer);
  }

  unscheduleSource(sourceId: string): void {
    const t = this.timers.get(sourceId);
    if (t) { clearInterval(t); this.timers.delete(sourceId); }
  }

  reschedule(source: IngestionSource): void {
    this.unscheduleSource(source.id);
    this.scheduleSource(source);
  }

  stopAll(): void {
    for (const [id] of this.timers) this.unscheduleSource(id);
  }
}
