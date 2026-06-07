// ============================================================
// contradiction.engine.ts — P5: Detect conflicting signals
// Pure graph history + event log analysis. No LLM.
// ============================================================

import type { GraphRepository } from './graph.repository';
import type {
  Contradiction, ContradictionType, ContradictionEvidence, GraphNode,
} from './graph.types';

// A contradiction requires at least this many days between conflicting signals
const MIN_DAYS_BETWEEN_SIGNALS = 7;

export class ContradictionEngine {
  constructor(private readonly repo: GraphRepository) {}

  // ---- Main entry point ------------------------------------

  /**
   * detectAll() — runs all detectors and returns deduplicated contradictions
   * sorted by confidence descending.
   */
  async detectAll(userId: string): Promise<Contradiction[]> {
    const [goalReversals, projectReversals, relationshipReversals] = await Promise.all([
      this.detectGoalReversals(userId),
      this.detectProjectReversals(userId),
      this.detectRelationshipReversals(userId),
    ]);

    return [...goalReversals, ...projectReversals, ...relationshipReversals]
      .sort((a, b) => b.confidence - a.confidence);
  }

  // ---- Detector 1: Goal Reversal ---------------------------
  // A GOAL node is archived/removed after previously being created + mentioned frequently.

  async detectGoalReversals(userId: string): Promise<Contradiction[]> {
    const events  = await this.repo.getRecentEvents(userId, 500);
    const results: Contradiction[] = [];

    // Find goals that were created then archived
    const goalCreated  = new Map<string, { ts: string; payload: any }>();
    const goalArchived = new Map<string, { ts: string; payload: any }>();

    for (const ev of events) {
      if (!ev.entity_id || ev.entity_kind !== 'node') continue;
      if (ev.event_type === 'NODE_CREATED') {
        goalCreated.set(ev.entity_id, { ts: ev.created_at, payload: ev.payload });
      }
      if (ev.event_type === 'NODE_UPDATED' && (ev.payload as any)?.is_archived === true) {
        goalArchived.set(ev.entity_id, { ts: ev.created_at, payload: ev.payload });
      }
    }

    // H-5: batch-fetch all candidate nodes in one query instead of 1 per event
    const candidateIds = [...goalCreated.keys()].filter(id => goalArchived.has(id));
    const nodeResults  = await Promise.all(
      candidateIds.map(id => this.repo.getNodeById(id, userId).catch(() => null)),
    );
    const nodeMap = new Map<string, GraphNode | null>(
      candidateIds.map((id, i) => [id, nodeResults[i]]),
    );

    for (const [nodeId, created] of goalCreated) {
      const archived = goalArchived.get(nodeId);
      if (!archived) continue;

      const daysBetween = (new Date(archived.ts).getTime() - new Date(created.ts).getTime()) / 86_400_000;
      if (daysBetween < MIN_DAYS_BETWEEN_SIGNALS) continue;

      const node = nodeMap.get(nodeId);
      if (node && node.node_type !== 'GOAL') continue;

      const confidence = Math.min(0.95, 0.6 + Math.min(daysBetween, 90) / 300);
      results.push({
        contradiction_type: 'GOAL_REVERSAL',
        confidence,
        entity_ids: [nodeId],
        evidence: [
          { event_id: null, description: `Goal created`, timestamp: created.ts, payload: created.payload },
          { event_id: null, description: `Goal archived after ${Math.round(daysBetween)} days`, timestamp: archived.ts, payload: archived.payload },
        ],
        detected_at: new Date().toISOString(),
      });
    }

    return results;
  }

  // ---- Detector 2: Project Reversal ------------------------
  // Edge from user→project created with WORKS_ON, then edge strength drops to < 0.2
  // OR project becomes disconnected (all edges archived).

  async detectProjectReversals(userId: string): Promise<Contradiction[]> {
    const projects = await this.repo.getNodesByType(userId, 'PROJECT', 100);
    const results: Contradiction[] = [];

    // C-2: single batch query instead of 1 per project
    const edgeMap = await this.repo.getEdgesByNodeIds(userId, projects.map(p => p.id));

    for (const project of projects) {
      const edges  = edgeMap.get(project.id) ?? [];
      const active  = edges.filter(e => !e.is_archived);
      const stale   = edges.filter(e => !e.is_archived && e.strength < 0.2 && e.mention_count >= 3);

      // Strong signal: project was active (had multiple mentions) but all edges now weak
      if (stale.length > 0 && active.length > 0 && stale.length === active.length) {
        const evidence: ContradictionEvidence[] = stale.map(e => ({
          event_id:    e.id,
          description: `Edge ${e.relationship_type} strength degraded to ${e.strength.toFixed(2)}`,
          timestamp:   e.last_seen_at,
          payload:     { edge_id: e.id, strength: e.strength, mention_count: e.mention_count },
        }));

        results.push({
          contradiction_type: 'PROJECT_REVERSAL',
          confidence:         0.72,
          entity_ids:         [project.id],
          evidence,
          detected_at:        new Date().toISOString(),
        });
      }
    }

    return results;
  }

  // ---- Detector 3: Relationship Reversal ------------------
  // Two events for the same edge pair: EDGE_CREATED then EDGE_REMOVED (or archived),
  // within a short window followed by recreation.

  async detectRelationshipReversals(userId: string): Promise<Contradiction[]> {
    const events  = await this.repo.getRecentEvents(userId, 500);
    const results: Contradiction[] = [];

    const edgeCreated = new Map<string, string[]>();  // edge_id → timestamps
    const edgeRemoved = new Map<string, string[]>();

    for (const ev of events) {
      if (!ev.entity_id || ev.entity_kind !== 'edge') continue;
      if (ev.event_type === 'EDGE_CREATED') {
        if (!edgeCreated.has(ev.entity_id)) edgeCreated.set(ev.entity_id, []);
        edgeCreated.get(ev.entity_id)!.push(ev.created_at);
      }
      if (ev.event_type === 'EDGE_REMOVED') {
        if (!edgeRemoved.has(ev.entity_id)) edgeRemoved.set(ev.entity_id, []);
        edgeRemoved.get(ev.entity_id)!.push(ev.created_at);
      }
    }

    // Edge that was created AND removed = relationship reversal
    for (const [edgeId, createdTs] of edgeCreated) {
      const removedTs = edgeRemoved.get(edgeId);
      if (!removedTs?.length) continue;

      const firstCreated = new Date(createdTs[0]).getTime();
      const firstRemoved = new Date(removedTs[0]).getTime();
      const daysBetween  = (firstRemoved - firstCreated) / 86_400_000;
      if (daysBetween < MIN_DAYS_BETWEEN_SIGNALS) continue;

      results.push({
        contradiction_type: 'RELATIONSHIP_REVERSAL',
        confidence:         Math.min(0.90, 0.55 + Math.min(daysBetween, 180) / 600),
        entity_ids:         [edgeId],
        evidence: [
          { event_id: null, description: `Relationship created`, timestamp: createdTs[0], payload: {} },
          { event_id: null, description: `Relationship removed after ${Math.round(daysBetween)} days`, timestamp: removedTs[0], payload: {} },
        ],
        detected_at: new Date().toISOString(),
      });
    }

    return results;
  }

  // ---- Detector 4: Priority Reversal ----------------------
  // A node's importance_score was high (>= 0.7) in one snapshot and
  // dropped significantly (>= 0.3) in the next.

  async detectPriorityReversals(userId: string): Promise<Contradiction[]> {
    const snapshots = await this.repo.getSnapshots(userId, 2);
    if (snapshots.length < 2) return [];

    // snapshots ordered newest-first; treat [0] as the reference (previous high) and [1] as current
    const [previous, latest] = snapshots;
    const latestMap = new Map<string, GraphNode>(
      (latest.snapshot.nodes as GraphNode[]).map(n => [n.id, n]),
    );

    const results: Contradiction[] = [];

    for (const prevNode of previous.snapshot.nodes as GraphNode[]) {
      const current = latestMap.get(prevNode.id);
      if (!current) continue;
      const delta = prevNode.importance_score - current.importance_score;
      if (prevNode.importance_score >= 0.7 && delta >= 0.3) {
        results.push({
          contradiction_type: 'PRIORITY_REVERSAL',
          confidence:         Math.min(0.95, 0.5 + delta),
          entity_ids:         [prevNode.id],
          evidence: [
            { event_id: null, description: `Importance was ${prevNode.importance_score.toFixed(2)}`, timestamp: previous.created_at, payload: { importance_score: prevNode.importance_score } },
            { event_id: null, description: `Importance dropped to ${current.importance_score.toFixed(2)}`, timestamp: latest.created_at, payload: { importance_score: current.importance_score } },
          ],
          detected_at: new Date().toISOString(),
        });
      }
    }

    return results;
  }
}
