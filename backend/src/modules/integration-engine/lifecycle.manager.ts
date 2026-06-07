// ============================================================
// lifecycle.manager.ts — Track pipeline run + stage state
// ============================================================
import type { IntegrationRepository } from './integration.repository';
import type {
  PipelineRun, PipelineStage, PipelineStatus, WorkflowType,
} from './integration.types';

export class LifecycleManager {
  constructor(private readonly repo: IntegrationRepository) {}

  async startRun(userId: string, workflow: WorkflowType, metadata: Record<string, unknown> = {}): Promise<PipelineRun> {
    return this.repo.createRun({ user_id: userId, workflow_type: workflow, status: 'RUNNING', metadata });
  }

  async completeRun(runId: string, status: 'COMPLETED' | 'FAILED'): Promise<void> {
    await this.repo.updateRun(runId, { status, completed_at: new Date().toISOString() });
  }

  async startStage(runId: string, stageName: string): Promise<PipelineStage> {
    return this.repo.createStage({ pipeline_run_id: runId, stage_name: stageName, status: 'RUNNING' });
  }

  async completeStage(
    stageId: string,
    status: PipelineStatus,
    durationMs: number,
    error?: string,
  ): Promise<void> {
    await this.repo.updateStage(stageId, {
      status,
      completed_at: new Date().toISOString(),
      duration_ms:  durationMs,
      error:        error ?? null,
    });
  }

  async getRun(runId: string): Promise<PipelineRun | null> {
    return this.repo.getRunById(runId);
  }

  async getStages(runId: string): Promise<PipelineStage[]> {
    return this.repo.getStagesByRun(runId);
  }
}
