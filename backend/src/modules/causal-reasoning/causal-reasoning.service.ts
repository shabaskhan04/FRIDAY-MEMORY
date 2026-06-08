// ============================================================
// causal-reasoning.service.ts — Causal inference from patterns
// ============================================================
import type { CausalReasoningRepository } from './causal-reasoning.repository';
import type { CausalRepository }          from '../causal-engine/causal.repository';
import type { ObservationRepository }     from '../observation-engine/observation.repository';
import type { AIRouter }                  from '../ai-engine/ai-router';
import type {
  CausalPattern, CausalPrediction, PatternType,
} from './causal-reasoning.types';
import type { Observation } from '../observation-engine/observation.types';

const MIN_OCCURRENCES_FOR_PATTERN = 2;
const MIN_CONFIDENCE_TO_CONFIRM   = 0.5;

export class CausalReasoningService {
  constructor(
    private readonly repo:      CausalReasoningRepository,
    private readonly causalRepo: CausalRepository,
    private readonly obsRepo:    ObservationRepository,
    private readonly ai:         AIRouter,
  ) {}

  // ---- Core discovery ----------------------------------------

  async discoverCausalPatterns(userId: string): Promise<CausalPattern[]> {
    const [observations, edges] = await Promise.all([
      this.obsRepo.listRecent(userId, 200),
      this.causalRepo.getAllCausalEdges(userId, 200),
    ]);

    const discovered: CausalPattern[] = [];

    // 1. Detect repeated sequences from observations
    discovered.push(...await this.detectRepeatedSequences(userId, observations));

    // 2. Promote strong causal edges (from existing causal-engine) to confirmed patterns
    for (const edge of edges) {
      if (edge.causal_strength >= 0.7 && edge.source_count >= MIN_OCCURRENCES_FOR_PATTERN) {
        const causeLabel = typeof this.repo.getNodeName === 'function'
          ? await this.repo.getNodeName(userId, edge.source_node_id)
          : edge.source_node_id;
        const effectLabel = typeof this.repo.getNodeName === 'function'
          ? await this.repo.getNodeName(userId, edge.target_node_id)
          : edge.target_node_id;

        const pattern = await this.repo.upsertPattern({
          user_id:          userId,
          pattern_type:     'REPEATED_SEQUENCE',
          cause_node_id:    edge.source_node_id,
          cause_label:      causeLabel,
          effect_node_id:   edge.target_node_id,
          effect_label:     effectLabel,
          description:      causeLabel === 'You'
            ? (edge.relationship_type === 'ENABLED' ? `You enabled ${effectLabel}` : `You worked on ${effectLabel}`)
            : `${causeLabel} leads to ${effectLabel} via ${edge.relationship_type}`,
          occurrence_count: edge.source_count,
          confidence:       edge.causal_strength,
          status:           'CONFIRMED',
          first_seen_at:    edge.last_seen_at,
          last_seen_at:     edge.last_seen_at,
        });
        discovered.push(pattern);
      }
    }

    // Discover and write goal blockers and accelerators
    await this.findGoalBlockers(userId, true);
    await this.findGoalAccelerators(userId, true);

    return discovered;
  }

  async getCausalPatterns(userId: string): Promise<CausalPattern[]> {
    return this.repo.getPatterns(userId);
  }

  async scoreCausalConfidence(patternId: string, userId: string): Promise<number> {
    const evidence = await this.repo.getEvidence(patternId);
    if (!evidence.length) return 0;
    const weightedSum = evidence.reduce((s, e) => s + e.weight, 0);
    return Math.min(0.99, weightedSum / evidence.length);
  }

  async findGoalBlockers(userId: string, writeToDb = true): Promise<CausalPattern[]> {
    if (writeToDb) {
      // Scan observations for declining goal-related activity
      const obs = await this.obsRepo.listRecent(userId, 100);
      const goalObs = obs.filter(o => o.categories?.includes('PROJECT') || o.categories?.includes('WORK'));

      // Detect sources correlated with low activity on goals
      const sourceCounts: Record<string, number> = {};
      for (const o of goalObs) sourceCounts[o.source] = (sourceCounts[o.source] ?? 0) + 1;

      // Sources that appear rarely among productive observations = potential blockers
      const rareThreshold = Math.max(1, goalObs.length * 0.1);
      for (const [source, count] of Object.entries(sourceCounts)) {
        if (count <= rareThreshold && count >= 2) {
          await this.repo.upsertPattern({
            user_id: userId, pattern_type: 'GOAL_BLOCKER',
            cause_node_id: null, cause_label: source,
            effect_node_id: null, effect_label: 'goal_progress',
            description: `${source} correlates with reduced goal activity`,
            occurrence_count: count, confidence: Math.min(0.7, count / goalObs.length + 0.3),
            status: count >= 3 ? 'CONFIRMED' : 'CANDIDATE',
            first_seen_at: new Date().toISOString(),
            last_seen_at: new Date().toISOString(),
          });
        }
      }
    }

    return this.repo.getPatterns(userId, 'GOAL_BLOCKER');
  }

  async findGoalAccelerators(userId: string, writeToDb = true): Promise<CausalPattern[]> {
    if (writeToDb) {
      const obs = await this.obsRepo.listRecent(userId, 100);
      const goalObs = obs.filter(o => o.categories?.includes('PROJECT') || o.categories?.includes('WORK'));

      // High-importance observations on productive days = accelerators
      const highImpactSources: Record<string, number> = {};
      for (const o of goalObs) {
        if (o.importance_score >= 0.7) {
          highImpactSources[o.source] = (highImpactSources[o.source] ?? 0) + 1;
        }
      }

      for (const [source, count] of Object.entries(highImpactSources)) {
        if (count >= MIN_OCCURRENCES_FOR_PATTERN) {
          await this.repo.upsertPattern({
            user_id: userId, pattern_type: 'GOAL_ACCELERATOR',
            cause_node_id: null, cause_label: source,
            effect_node_id: null, effect_label: 'goal_progress',
            description: `${source} correlates with high-impact goal activity`,
            occurrence_count: count, confidence: Math.min(0.85, count / Math.max(1, goalObs.length)),
            status: count >= 3 ? 'CONFIRMED' : 'CANDIDATE',
            first_seen_at: new Date().toISOString(),
            last_seen_at: new Date().toISOString(),
          });
        }
      }
    }

    return this.repo.getPatterns(userId, 'GOAL_ACCELERATOR');
  }

  async predictOutcome(userId: string, condition: string): Promise<CausalPrediction> {
    const patterns = await this.repo.getPatterns(userId);
    const confirmed = patterns.filter(p => p.status === 'CONFIRMED').slice(0, 5);

    const context = confirmed.length
      ? confirmed.map(p => `- ${p.cause_label} → ${p.effect_label} (conf: ${p.confidence.toFixed(2)})`).join('\n')
      : 'No confirmed patterns yet.';

    const aiAnswer = await this.ai.generate(
      'causal_pattern_inference',
      'You are a causal inference engine. Given known patterns, predict the likely outcome. Return JSON only: {"predicted_outcome":"...","confidence":0.0}',
      `Known patterns:\n${context}\n\nCondition: ${condition}`,
      { temperature: 0.2, maxTokens: 200 },
    ).catch(() => '{"predicted_outcome":"Insufficient data","confidence":0.3}');

    let parsed: any = {};
    try { parsed = JSON.parse(aiAnswer.replace(/```json\n?|\n?```/g, '')); } catch {}

    return this.repo.savePrediction({
      user_id:             userId,
      pattern_id:          confirmed[0]?.id ?? '',
      input_condition:     condition,
      predicted_outcome:   parsed.predicted_outcome ?? aiAnswer,
      confidence:          Math.min(1, Math.max(0, parsed.confidence ?? 0.4)),
      supporting_patterns: confirmed.map(p => p.id),
      expires_at:          new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
    });
  }

  // ---- Private helpers -------------------------------------

  private async detectRepeatedSequences(userId: string, observations: Observation[]): Promise<CausalPattern[]> {
    // Sliding window: find pairs of sources that frequently co-occur within 30 min
    const WINDOW_MS = 30 * 60_000;
    const pairCounts: Record<string, { count: number; lastSeen: string }> = {};

    for (let i = 0; i < observations.length - 1; i++) {
      const a = observations[i];
      const b = observations[i + 1];
      const delta = Math.abs(new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime());
      if (delta > WINDOW_MS) continue;

      const key = `${a.source}→${b.source}`;
      pairCounts[key] = {
        count: (pairCounts[key]?.count ?? 0) + 1,
        lastSeen: b.occurred_at,
      };
    }

    const results: CausalPattern[] = [];
    for (const [key, { count, lastSeen }] of Object.entries(pairCounts)) {
      if (count < MIN_OCCURRENCES_FOR_PATTERN) continue;
      const [cause, effect] = key.split('→');
      const confidence = Math.min(0.9, 0.3 + count * 0.1);
      const pattern = await this.repo.upsertPattern({
        user_id: userId, pattern_type: 'REPEATED_SEQUENCE',
        cause_node_id: null, cause_label: cause,
        effect_node_id: null, effect_label: effect,
        description: `${cause} is frequently followed by ${effect}`,
        occurrence_count: count, confidence,
        status: confidence >= MIN_CONFIDENCE_TO_CONFIRM ? 'CONFIRMED' : 'CANDIDATE',
        first_seen_at: observations[0]?.occurred_at ?? new Date().toISOString(),
        last_seen_at: lastSeen,
      });
      results.push(pattern);
    }
    return results;
  }
}
