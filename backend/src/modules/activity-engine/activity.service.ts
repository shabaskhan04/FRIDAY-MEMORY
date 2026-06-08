// ============================================================
// activity.service.ts — Orchestration: obs → clusters → activities
// ============================================================
import type { ActivityRepository } from './activity.repository';
import type { CorrelationEngine }  from './correlation.engine';
import type { TimelineEngine }     from './timeline.engine';
import type { ActivityInsights }   from './activity-insights';
import type { Observation }        from '../observation-engine/observation.types';
import type { Activity, ActivityCandidate, DayTimeline, ActivitySummary } from './activity.types';
import { getSignalQuality }        from './activity.scoring';

import type { AIRouter } from '../ai-engine/ai-router';

export class ActivityService {
  constructor(
    private readonly repo:        ActivityRepository,
    private readonly correlator:  CorrelationEngine,
    private readonly timeline:    TimelineEngine,
    private readonly insights:    ActivityInsights,
    private readonly aiRouter?:   AIRouter,
  ) {}

  // ---- Core pipeline: observations → activities -----------

  /**
   * processObservations() — run the full pipeline:
   *   1. Correlate observations into clusters
   *   2. Score each cluster
   *   3. Persist activities + join records
   *   Returns persisted Activity records.
   */
  async processObservations(
    userId: string,
    observations: Observation[],
  ): Promise<Activity[]> {
    const candidates: ActivityCandidate[] = this.correlator.correlate(observations);
    if (!candidates.length) return [];

    const enrichedInputs = await Promise.all(candidates.map(async (c) => {
      let title = c.title;
      if (this.aiRouter) {
        try {
          const obsDetails = c.cluster.observations.map(o => `- ${o.title} (${o.description ?? ""})`).join("\n");
          const contextText = `Category: ${c.category}\nObservations:\n${obsDetails}`;
          const systemPrompt = `You are Friday's activity clustering engine. Summarize the user's clustered observations into a brief, active, descriptive title (5-10 words, e.g. "Worked on FRIDAY code with Shanavas"). Do not include quotes, preamble, or markdown.`;

          const aiResponse = await this.aiRouter.generate(
            'activity_clustering',
            systemPrompt,
            contextText,
            { temperature: 0.3, maxTokens: 100 }
          );
          if (aiResponse.trim()) {
            title = aiResponse.trim().replace(/^["']|["']$/g, '');
          }
        } catch (err) {
          console.error("[ActivityService] AI clustering summary failed, using default title:", err);
        }
      }

      return {
        user_id:          userId,
        title,
        category:         c.category,
        started_at:       c.cluster.start_time.toISOString(),
        ended_at:         c.cluster.end_time.toISOString(),
        importance_score: c.importance_score,
        confidence_score: c.confidence_score,
        signal_quality:   c.signal_quality,
        related_entities: c.cluster.entities,
        metadata:         {},
      };
    }));

    const activities = await this.repo.createMany(enrichedInputs);

    // Link observation IDs to each activity
    for (let i = 0; i < activities.length; i++) {
      const obsIds = candidates[i].cluster.observations.map(o => o.id);
      await this.repo.linkObservations(activities[i].id, obsIds);
    }

    // Trigger downstream live updates (async/fire-and-forget)
    (async () => {
      try {
        const { getCausalReasoningService, getDigitalTwinService, getGraphService } = await import('../../lib/intelligence');
        const causalReasoningService = getCausalReasoningService();
        const digitalTwinService = getDigitalTwinService();
        const graphService = getGraphService();

        // Instantiate low level CausalService
        const { CausalRepository } = await import('../causal-engine/causal.repository');
        const { CausalAnalysis } = await import('../causal-engine/causal.analysis');
        const { CausalPathEngine } = await import('../causal-engine/causal-path.engine');
        const { CausalService: LowLevelCausalService } = await import('../causal-engine/causal.service');
        const { createServiceClient } = await import('../../lib/supabase');

        const db = createServiceClient();
        const causalRepo = new CausalRepository(db);
        const getName = async (uId: string, nId: string) => {
          const node = await graphService.getNode(uId, nId);
          return node?.name ?? 'Unknown';
        };
        const causalPathEngine = new CausalPathEngine(causalRepo, getName);
        const causalAnalysis = new CausalAnalysis(causalRepo, causalPathEngine);
        const lowLevelCausal = new LowLevelCausalService(causalRepo, causalAnalysis, causalPathEngine);

        const mapSourceToCausalSource = (src: string): any => {
          const valid = ['GIT_COMMIT', 'EMAIL_SENT', 'CALENDAR_EVENT', 'FILE_CHANGE', 'HEALTH_UPDATE', 'APP_USAGE', 'MANUAL'];
          if (valid.includes(src)) return src;
          if (src.startsWith('GIT_')) return 'GIT_COMMIT';
          if (src.startsWith('EMAIL_')) return 'EMAIL_SENT';
          if (src.startsWith('FILE_')) return 'FILE_CHANGE';
          return 'MANUAL';
        };

        for (const obs of observations) {
          if (obs.metadata?.source_node_id && obs.metadata?.target_node_id) {
            await lowLevelCausal.processObservation({
              id: obs.id,
              user_id: userId,
              source: {
                type: mapSourceToCausalSource(obs.source),
                external_id: null,
                metadata: {
                  source_node_id: obs.metadata.source_node_id as string,
                  target_node_id: obs.metadata.target_node_id as string,
                }
              },
              entity_name: obs.related_entities[0] ?? 'Unknown',
              description: obs.description ?? obs.title,
              observed_at: obs.occurred_at,
              processed: true,
            });
          }
        }

        // Rebuild twin model and causal pattern discovery
        await Promise.all([
          digitalTwinService.generateSelfModel(userId),
          causalReasoningService.discoverCausalPatterns(userId),
        ]);
      } catch (err) {
        console.error("[ActivityService] Downstream live updates failed:", err);
      }
    })().catch(err => console.error("[ActivityService] Async downstream error:", err));

    return activities;
  }

  /**
   * enrichSignalQuality() — update signal_quality_score on raw observations.
   * Called after observations are stored but before correlation.
   * Returns the observation list with quality scores filled in (in-memory only —
   * caller persists via observation repo).
   */
  enrichSignalQuality(observations: Observation[]): Array<Observation & { signal_quality_score: number }> {
    return observations.map(o => ({
      ...o,
      signal_quality_score: getSignalQuality(o.source).score,
    }));
  }

  // ---- Queries --------------------------------------------

  async getActivity(userId: string, id: string): Promise<Activity | null> {
    return this.repo.getById(id, userId);
  }

  async getActivityWithObservations(userId: string, id: string): Promise<{ activity: Activity; observation_ids: string[] } | null> {
    const activity = await this.repo.getById(id, userId);
    if (!activity) return null;
    const observation_ids = await this.repo.getObservationIds(id);
    return { activity, observation_ids };
  }

  // ---- Timeline -------------------------------------------

  async getDayTimeline(userId: string, date: Date): Promise<DayTimeline> {
    return this.timeline.reconstructDay(userId, date);
  }

  async getRecentTimeline(userId: string, days = 7): Promise<DayTimeline[]> {
    return this.insights.getRecentTimeline(userId, days);
  }

  // ---- Insights -------------------------------------------

  async getCategorySummary(userId: string, days?: number): Promise<ActivitySummary[]> {
    return this.insights.getCategorySummary(userId, days);
  }

  async getTopActivities(userId: string, days?: number): Promise<Activity[]> {
    return this.insights.getTopActivities(userId, days);
  }

  async getMostActiveHours(userId: string, days?: number): Promise<Array<{ hour: number; count: number }>> {
    return this.insights.getMostActiveHours(userId, days);
  }

  async getEntityFocus(userId: string, days?: number): Promise<Array<{ entity: string; count: number }>> {
    return this.insights.getEntityFocus(userId, days);
  }

  async listRecent(userId: string, limit = 50): Promise<Activity[]> {
    return this.repo.listRecent(userId, limit);
  }
}
