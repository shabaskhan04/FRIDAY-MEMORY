// ============================================================
// pipeline.engine.ts — Stage execution: retry + failure isolation
// ============================================================
import type { LifecycleManager }  from './lifecycle.manager';
import type { FailureHandler }    from './failure-handler';
import type { EventBus }          from './event-bus';
import type {
  WorkflowDefinition, StageResult, StageContext,
  PipelineRun,
} from './integration.types';

export class PipelineEngine {
  constructor(
    private readonly lifecycle: LifecycleManager,
    private readonly failures:  FailureHandler,
    private readonly bus:       EventBus,
  ) {}

  /**
   * run() — execute a workflow against input.
   * Each stage receives the output of the previous stage as its input.
   * A recoverable stage failure records the error and skips to the next stage.
   * A non-recoverable stage failure halts the pipeline immediately.
   */
  async run<TInput>(
    workflow: WorkflowDefinition,
    userId: string,
    input: TInput,
  ): Promise<{ run: PipelineRun; results: StageResult[] }> {
    const run = await this.lifecycle.startRun(userId, workflow.type);
    const ctx: StageContext = { run_id: run.id, user_id: userId, workflow: workflow.type };

    const results: StageResult[] = [];
    let current: unknown = input;
    let pipelineFailed   = false;

    for (const stage of workflow.stages) {
      const stageRecord = await this.lifecycle.startStage(run.id, stage.name);
      const start       = Date.now();

      const [output, error, retries] = await this.failures.execute(stage, current, ctx);
      const duration_ms = Date.now() - start;

      const status = error
        ? ((stage.recoverable ?? true) ? 'SKIPPED' : 'FAILED')
        : 'COMPLETED';

      await this.lifecycle.completeStage(stageRecord.id, status, duration_ms, error ?? undefined);

      results.push({ stage_name: stage.name, status, output, error, duration_ms, retries });

      if (status === 'FAILED') {
        pipelineFailed = true;
        break;
      }

      // Pass output forward only if stage completed; otherwise pass current unchanged
      if (status === 'COMPLETED' && output !== null) current = output;
    }

    const finalStatus = pipelineFailed ? 'FAILED' : 'COMPLETED';
    await this.lifecycle.completeRun(run.id, finalStatus);

    this.bus.emit(
      pipelineFailed ? 'PIPELINE_FAILED' : 'PIPELINE_COMPLETED',
      userId,
      { run_id: run.id, workflow: workflow.type, results },
    );

    return { run: { ...run, status: finalStatus }, results };
  }
}
