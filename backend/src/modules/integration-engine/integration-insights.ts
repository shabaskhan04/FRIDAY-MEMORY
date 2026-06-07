// ============================================================
// integration-insights.ts — Operational visibility (not user-facing)
// ============================================================
import type { IntegrationRepository } from './integration.repository';
import type { PipelineRun, PipelineStage } from './integration.types';

export interface PipelineHealth {
  status:       'HEALTHY' | 'DEGRADED' | 'CRITICAL';
  success_rate: number;
  notes:        string[];
}

export interface Bottleneck {
  stage_name:   string;
  avg_duration_ms: number;
  run_count:    number;
}

export interface FailurePattern {
  stage_name:   string;
  failure_count: number;
  sample_errors: string[];
}

export class IntegrationInsights {
  constructor(private readonly repo: IntegrationRepository) {}

  async getPipelineHealth(userId: string): Promise<PipelineHealth> {
    const runs = await this.repo.listRuns(userId, 100);
    if (!runs.length) return { status: 'HEALTHY', success_rate: 1, notes: ['No runs yet'] };

    const recent     = runs.slice(0, 20);
    const succeeded  = recent.filter(r => r.status === 'COMPLETED').length;
    const rate       = succeeded / recent.length;
    const notes: string[] = [];

    if (rate < 0.6) notes.push(`${recent.filter(r => r.status === 'FAILED').length} recent failures`);
    const status: PipelineHealth['status'] = rate >= 0.9 ? 'HEALTHY' : rate >= 0.7 ? 'DEGRADED' : 'CRITICAL';

    return { status, success_rate: rate, notes };
  }

  async getBottlenecks(userId: string, topN = 5): Promise<Bottleneck[]> {
    const runs   = await this.repo.listRuns(userId, 100);
    const map    = new Map<string, { total: number; count: number }>();

    for (const run of runs) {
      const stages = await this.repo.getStagesByRun(run.id);
      for (const s of stages) {
        if (s.duration_ms == null) continue;
        const entry = map.get(s.stage_name) ?? { total: 0, count: 0 };
        entry.total += s.duration_ms;
        entry.count++;
        map.set(s.stage_name, entry);
      }
    }

    return Array.from(map.entries())
      .map(([stage_name, s]) => ({ stage_name, avg_duration_ms: s.total / s.count, run_count: s.count }))
      .sort((a, b) => b.avg_duration_ms - a.avg_duration_ms)
      .slice(0, topN);
  }

  async getFailurePatterns(userId: string): Promise<FailurePattern[]> {
    const runs = await this.repo.listRuns(userId, 200);
    const map  = new Map<string, { count: number; errors: string[] }>();

    for (const run of runs.filter(r => r.status === 'FAILED')) {
      const stages = await this.repo.getStagesByRun(run.id);
      for (const s of stages.filter(s => s.status === 'FAILED' && s.error)) {
        const entry = map.get(s.stage_name) ?? { count: 0, errors: [] };
        entry.count++;
        if (entry.errors.length < 3) entry.errors.push(s.error!);
        map.set(s.stage_name, entry);
      }
    }

    return Array.from(map.entries())
      .map(([stage_name, v]) => ({ stage_name, failure_count: v.count, sample_errors: v.errors }))
      .sort((a, b) => b.failure_count - a.failure_count);
  }

  async getSlowestStages(userId: string, topN = 5): Promise<Bottleneck[]> {
    return this.getBottlenecks(userId, topN);
  }
}
