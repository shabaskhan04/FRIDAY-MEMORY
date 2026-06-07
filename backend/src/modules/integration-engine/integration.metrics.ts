// ============================================================
// integration.metrics.ts — Operational pipeline metrics
// ============================================================
import type { IntegrationRepository } from './integration.repository';
import type { PipelineMetrics, WorkflowMetrics, WorkflowType } from './integration.types';

export class IntegrationMetrics {
  constructor(private readonly repo: IntegrationRepository) {}

  async getPipelineMetrics(userId: string): Promise<PipelineMetrics> {
    const runs = await this.repo.listRuns(userId, 500);
    if (!runs.length) return this.emptyMetrics();

    const total     = runs.length;
    const succeeded = runs.filter(r => r.status === 'COMPLETED').length;
    const failed    = runs.filter(r => r.status === 'FAILED').length;
    const durations = runs.filter(r => r.duration_ms !== null).map(r => r.duration_ms!);
    const avgDur    = durations.length ? durations.reduce((s, v) => s + v, 0) / durations.length : 0;

    // Stage-level: find most failed stage across recent runs
    const recentRunIds = runs.slice(0, 100).map(r => r.id);
    const stageFailMap = new Map<string, number>();
    let totalRetries   = 0;

    for (const runId of recentRunIds) {
      const stages = await this.repo.getStagesByRun(runId);
      for (const s of stages) {
        if (s.status === 'FAILED') {
          stageFailMap.set(s.stage_name, (stageFailMap.get(s.stage_name) ?? 0) + 1);
        }
      }
    }

    const mostFailed = stageFailMap.size
      ? [...stageFailMap.entries()].sort(([, a], [, b]) => b - a)[0][0]
      : null;

    return {
      total_runs:         total,
      success_rate:       total ? succeeded / total : 0,
      avg_duration_ms:    avgDur,
      failure_rate:       total ? failed / total : 0,
      most_failed_stage:  mostFailed,
      retry_rate:         0, // computed per-stage in getWorkflowMetrics
    };
  }

  async getWorkflowMetrics(userId: string): Promise<WorkflowMetrics[]> {
    const runs = await this.repo.listRuns(userId, 500);
    const byWorkflow = new Map<WorkflowType, typeof runs>();

    for (const run of runs) {
      if (!byWorkflow.has(run.workflow_type)) byWorkflow.set(run.workflow_type, []);
      byWorkflow.get(run.workflow_type)!.push(run);
    }

    return Array.from(byWorkflow.entries()).map(([workflow_type, wRuns]) => {
      const succeeded  = wRuns.filter(r => r.status === 'COMPLETED').length;
      const durations  = wRuns.filter(r => r.duration_ms !== null).map(r => r.duration_ms!);
      return {
        workflow_type,
        run_count:       wRuns.length,
        success_rate:    wRuns.length ? succeeded / wRuns.length : 0,
        avg_duration_ms: durations.length ? durations.reduce((s, v) => s + v, 0) / durations.length : 0,
      };
    });
  }

  private emptyMetrics(): PipelineMetrics {
    return { total_runs: 0, success_rate: 0, avg_duration_ms: 0, failure_rate: 0, most_failed_stage: null, retry_rate: 0 };
  }
}
