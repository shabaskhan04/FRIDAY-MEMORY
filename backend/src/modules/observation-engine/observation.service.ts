// ============================================================
// observation.service.ts — Orchestration layer
// ============================================================
import type { ObservationRepository }  from './observation.repository';
import type { ObservationProcessor }   from './observation.processor';
import type { ObservationInsights }    from './observation-insights';
import type { ObservationTimeline }    from './observation.timeline';
import type {
  Observation, CreateObservationInput, ObservationSource,
  ObservationCategory, ObservationDistribution,
  SourceSummary, ActivityTrend, AttentionDrift,
  ConnectorConfig, IConnector,
} from './observation.types';
import type { ProcessingContext } from './observation.processor';

export class ObservationService {
  constructor(
    private readonly repo:      ObservationRepository,
    private readonly processor: ObservationProcessor,
    private readonly insights:  ObservationInsights,
    private readonly timeline:  ObservationTimeline,
  ) {}

  // ---- Ingestion ------------------------------------------

  async observe(input: CreateObservationInput, ctx?: ProcessingContext): Promise<Observation> {
    return this.processor.process(input, ctx);
  }

  async observeBatch(inputs: CreateObservationInput[], ctx?: ProcessingContext): Promise<Observation[]> {
    return this.processor.processBatch(inputs, ctx);
  }

  async drainUnprocessed(userId: string): Promise<number> {
    return this.processor.drainUnprocessed(userId);
  }

  // ---- Queries --------------------------------------------

  async getById(userId: string, id: string): Promise<Observation | null> {
    return this.repo.getById(id, userId);
  }

  async listRecent(userId: string, limit = 100): Promise<Observation[]> {
    return this.repo.listRecent(userId, limit);
  }

  async listBySource(userId: string, source: ObservationSource): Promise<Observation[]> {
    return this.repo.listBySource(userId, source);
  }

  async listByCategory(userId: string, category: ObservationCategory): Promise<Observation[]> {
    return this.repo.listByCategory(userId, category);
  }

  // ---- Insights -------------------------------------------

  async getDistribution(userId: string, days?: number): Promise<ObservationDistribution> {
    return this.insights.getObservationDistribution(userId, days);
  }

  async getTopSources(userId: string, days?: number): Promise<SourceSummary[]> {
    return this.insights.getTopObservationSources(userId, days);
  }

  async getAttentionDrift(userId: string, days?: number): Promise<AttentionDrift> {
    return this.insights.getAttentionDrift(userId, days);
  }

  async getEmergingActivities(userId: string, days?: number): Promise<ActivityTrend[]> {
    return this.insights.getEmergingActivities(userId, days);
  }

  async getDecliningActivities(userId: string, days?: number): Promise<ActivityTrend[]> {
    return this.insights.getDecliningActivities(userId, days);
  }

  async getTrends(userId: string, days?: number): Promise<ActivityTrend[]> {
    return this.insights.getObservationTrends(userId, days);
  }

  // ---- Timeline -------------------------------------------

  async getTimeline(userId: string, from: Date, to: Date, granularity?: 'day' | 'week' | 'month') {
    return this.timeline.getTimeline(userId, from, to, granularity);
  }

  // ---- Future connector registry (architecture only) ------
  // Connectors are registered here and called by future batch jobs.
  // No actual integrations. No external calls.

  private connectors = new Map<string, IConnector>();

  /**
   * registerConnector() — register a source connector implementation.
   * Called during module bootstrap when a connector is available.
   * No-op until connectors are implemented in Phase 2.
   */
  registerConnector(connector: IConnector): void {
    this.connectors.set(connector.type, connector);
  }

  /**
   * runConnector() — trigger a single connector and ingest its output.
   * Placeholder: validates config and returns empty array until implemented.
   */
  async runConnector(connector: IConnector, config: ConnectorConfig): Promise<Observation[]> {
    const valid = await connector.validate(config);
    if (!valid) throw new Error(`Connector ${config.connector_type} failed validation`);
    const inputs = await connector.ingest(config);
    return this.observeBatch(inputs.map(i => ({ ...i, user_id: config.user_id })));
  }

  listRegisteredConnectors(): string[] {
    return Array.from(this.connectors.keys());
  }
}
