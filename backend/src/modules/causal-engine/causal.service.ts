// ============================================================
// causal.service.ts — Orchestration + observation interface
// ============================================================
import type { CausalRepository }  from './causal.repository';
import type { CausalAnalysis }    from './causal.analysis';
import type { CausalPathEngine }  from './causal-path.engine';
import type {
  CausalEdge, CreateCausalEdgeInput,
  CausalPath, RootCauseResult, DownstreamEffect, InfluentialNode,
  ObservationEvent,
} from './causal.types';
import { CreateCausalEdgeSchema } from './causal.schemas';

export class CausalService {
  constructor(
    private readonly repo:     CausalRepository,
    private readonly analysis: CausalAnalysis,
    private readonly pathEngine: CausalPathEngine,
  ) {}

  // ---- Edge management -------------------------------------

  async createCausalEdge(input: CreateCausalEdgeInput): Promise<CausalEdge> {
    const validated = CreateCausalEdgeSchema.parse(input);
    return this.repo.createCausalEdge(validated as CreateCausalEdgeInput);
  }

  async getCausalEdgesFrom(userId: string, nodeId: string): Promise<CausalEdge[]> {
    return this.repo.getCausalEdgesFrom(userId, nodeId);
  }

  async getCausalEdgesTo(userId: string, nodeId: string): Promise<CausalEdge[]> {
    return this.repo.getCausalEdgesTo(userId, nodeId);
  }

  async updateCausalStrength(userId: string, edgeId: string, strength: number): Promise<void> {
    return this.repo.updateCausalStrength(edgeId, userId, strength);
  }

  // ---- Path analysis ---------------------------------------

  async findCausalPath(userId: string, fromNodeId: string, toNodeId: string): Promise<CausalPath | null> {
    return this.analysis.findCausalPath(userId, fromNodeId, toNodeId);
  }

  async findRootCauses(userId: string, effectNodeId: string, maxDepth = 4): Promise<RootCauseResult[]> {
    return this.analysis.findRootCauses(userId, effectNodeId, maxDepth);
  }

  async findDownstreamEffects(userId: string, causeNodeId: string, maxDepth = 4): Promise<DownstreamEffect[]> {
    return this.analysis.findDownstreamEffects(userId, causeNodeId, maxDepth);
  }

  async findMostInfluentialNodes(userId: string, limit = 10): Promise<InfluentialNode[]> {
    return this.analysis.findMostInfluentialNodes(userId, limit);
  }

  async getCausalSummary(userId: string) {
    return this.analysis.getCausalSummary(userId);
  }

  // ---- Observation interface (future-compatible) ----------
  // These are architectural placeholders only.
  // No integrations. No external APIs. No collectors.
  // Implement the body when observation pipelines are built.

  /**
   * processObservation() — entry point for future observation collectors.
   *
   * When a GIT_COMMIT, CALENDAR_EVENT, HEALTH_UPDATE, etc. arrives,
   * this method will:
   *   1. Extract entities from the observation
   *   2. Infer causal edges (if applicable)
   *   3. Update relevant graph nodes
   *   4. Store the observation for audit
   *
   * For now: interface only, logs the observation and returns undefined.
   */
  async processObservation(observation: ObservationEvent): Promise<void> {
    if (!observation?.source?.type || !observation.user_id) return;
    const { user_id, source, entity_name, description } = observation;

    // Only create causal edges when we have two named entities to link
    // For now handle the two clearest causal source types
    const CAUSAL_SOURCES: Partial<Record<string, { strength: number; rel: CausalEdge['relationship_type'] }>> = {
      GIT_COMMIT:     { strength: 0.7, rel: 'CONTRIBUTED_TO' },
      CALENDAR_EVENT: { strength: 0.6, rel: 'ENABLED' },
      HEALTH_UPDATE:  { strength: 0.65, rel: 'CONTRIBUTED_TO' },
    };

    const config = CAUSAL_SOURCES[source.type];
    if (!config || !entity_name) return;

    // Look up matching source node id — if payload has source_node_id use it directly
    const sourceNodeId = (source.metadata?.source_node_id as string | undefined) ?? null;
    const targetNodeId = (source.metadata?.target_node_id as string | undefined) ?? null;
    if (!sourceNodeId || !targetNodeId || sourceNodeId === targetNodeId) return;

    await this.repo.createCausalEdge({
      user_id,
      source_node_id: sourceNodeId,
      target_node_id: targetNodeId,
      relationship_type: config.rel,
      causal_strength: config.strength,
      confidence: 0.6,
      evidence: [{ description, source_memory_id: undefined, timestamp: observation.observed_at, weight: 0.6 }],
    });
  }
}
