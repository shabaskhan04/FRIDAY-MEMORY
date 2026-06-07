// ============================================================
// failure-handler.ts — Failure isolation + retry policy
// ============================================================
import type { FailureRecord, StageDefinition } from './integration.types';

const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_TIMEOUT_MS  = 30_000;
const MAX_FAILURE_RECORDS = 1_000; // C-3: ring buffer cap

const delay = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

export class FailureHandler {
  private readonly failures: FailureRecord[] = [];

  /**
   * execute() — runs a stage function with timeout + exponential backoff retry (C-5).
   */
  async execute<TIn, TOut>(
    stage: StageDefinition<TIn, TOut>,
    input: TIn,
    ctx: import('./integration.types').StageContext,
  ): Promise<[TOut | null, string | null, number]> {
    const maxRetries = stage.maxRetries  ?? DEFAULT_MAX_RETRIES;
    const timeoutMs  = stage.timeoutMs   ?? DEFAULT_TIMEOUT_MS;
    let lastError    = '';
    let attempts     = 0;

    while (attempts <= maxRetries) {
      try {
        const result = await this.withTimeout(stage.fn(input, ctx), timeoutMs);
        return [result, null, attempts];
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        attempts++;
        if (attempts <= maxRetries) {
          // C-5: exponential backoff — 200ms, 400ms, 800ms…
          await delay(200 * Math.pow(2, attempts - 1));
        }
      }
    }

    this.record(ctx.run_id, stage.name, lastError, attempts - 1, stage.recoverable ?? true);
    return [null, lastError, attempts - 1];
  }

  private withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(`Stage timed out after ${ms}ms`)), ms),
      ),
    ]);
  }

  // C-3: ring buffer — oldest entry dropped when cap reached
  private record(
    run_id: string, stage_name: string, error: string,
    retryCount: number, recoverable: boolean,
  ): void {
    if (this.failures.length >= MAX_FAILURE_RECORDS) this.failures.shift();
    this.failures.push({ run_id, stage_name, error, retryCount, recoverable, timestamp: new Date().toISOString() });
  }

  // H-7: require run_id — prevents cross-user failure data leakage
  getFailures(runId: string): FailureRecord[] {
    return this.failures.filter(f => f.run_id === runId);
  }

  clearFailures(): void {
    this.failures.length = 0;
  }
}
