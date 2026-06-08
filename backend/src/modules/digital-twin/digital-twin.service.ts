// ============================================================
// digital-twin.service.ts — Behavioral model builder
// ============================================================
import type { DigitalTwinRepository } from './digital-twin.repository';
import type { AIRouter }              from '../ai-engine/ai-router';
import type { GraphService }          from '../knowledge-graph/graph.service';
import type { ObservationService }    from '../observation-engine/observation.service';
import type { DecisionService }       from '../decision-engine/decision.service';
import type {
  DigitalTwinProfile, DigitalTwinTrait, DigitalTwinPrediction,
  SelfModel, PredictionEvidence, PredictionType,
} from './digital-twin.types';

const TWIN_SYSTEM_PROMPT = `You are analyzing a user's behavioral patterns to build a digital twin model.
Return JSON only. Be evidence-based and concise.`;

export class DigitalTwinService {
  constructor(
    private readonly repo:        DigitalTwinRepository,
    private readonly ai:          AIRouter,
    private readonly graphService: GraphService,
    private readonly obsService:   ObservationService,
    private readonly decisionService: DecisionService,
  ) {}

  async getProfile(userId: string): Promise<DigitalTwinProfile | null> {
    return this.repo.getProfile(userId);
  }

  async updateProfile(userId: string, patch: Partial<DigitalTwinProfile>): Promise<DigitalTwinProfile> {
    return this.repo.upsertProfile(userId, patch);
  }

  async generateSelfModel(userId: string): Promise<SelfModel> {
    const [nodes, observations, decisions] = await Promise.all([
      this.graphService.getMostImportantNodes(userId, 30).catch(() => [] as any[]),
      this.obsService.listRecent(userId, 100).catch(() => [] as any[]),
      this.decisionService.listDecisions(userId).catch(() => [] as any[]),
    ]);

    const goals    = nodes.filter(n => n.node_type === 'GOAL').slice(0, 5).map(n => n.name);
    const projects = nodes.filter(n => n.node_type === 'PROJECT').slice(0, 5).map(n => n.name);
    const people   = nodes.filter(n => n.node_type === 'PERSON').slice(0, 5).map(n => n.name);

    // Compute work hours pattern from observations
    const hoursPattern: Record<string, number> = {};
    for (const obs of observations) {
      const h = new Date(obs.occurred_at).getUTCHours().toString();
      hoursPattern[h] = (hoursPattern[h] ?? 0) + 1;
    }

    // Derive productivity peak
    const peakHour = Object.entries(hoursPattern).sort((a, b) => b[1] - a[1])[0];
    const peakLabel = peakHour
      ? +peakHour[0] < 12 ? 'morning' : +peakHour[0] < 17 ? 'afternoon' : 'evening'
      : null;

    // Decision stats
    const completedDecisions = decisions.filter((d: any) => d.status === 'COMPLETED');
    const avgConf = decisions.length
      ? decisions.reduce((s: number, d: any) => s + (d.confidence_score ?? 0.5), 0) / decisions.length
      : 0.5;

    // Risk profile from decisions
    const highConfDecisions = decisions.filter((d: any) => d.expected_success_probability > 0.7).length;
    const riskProfile = highConfDecisions / Math.max(1, decisions.length) > 0.6
      ? 'AGGRESSIVE' : highConfDecisions / Math.max(1, decisions.length) > 0.4
      ? 'MODERATE' : 'CONSERVATIVE';

    // Build AI-generated summary
    const summaryContext = `Goals: ${goals.join(', ')}. Projects: ${projects.join(', ')}. People: ${people.join(', ')}. Peak productivity: ${peakLabel}. Decisions made: ${decisions.length}. Risk profile: ${riskProfile}.`;
    const summary = await this.ai.generate(
      'twin_model_generation',
      TWIN_SYSTEM_PROMPT,
      `Summarize this person's behavioral profile in 2-3 sentences:\n${summaryContext}`,
      { temperature: 0.3, maxTokens: 200 },
    ).catch(() => summaryContext);

    const profile = await this.repo.upsertProfile(userId, {
      top_goals: goals, top_projects: projects, top_people: people,
      work_hours_pattern: hoursPattern, productivity_peak: peakLabel,
      avg_decision_confidence: avgConf, risk_profile: riskProfile,
      summary, last_rebuilt_at: new Date().toISOString(),
    });

    // Extract traits from patterns
    const traits = await this.extractTraits(userId, profile.id, observations, decisions);

    // Generate predictions
    const predictions = await this.generatePredictions(userId, profile, nodes, observations);

    return { profile, traits, predictions, generated_at: new Date().toISOString() };
  }

  async predictPreference(userId: string, question: string): Promise<DigitalTwinPrediction> {
    const profile = await this.repo.getProfile(userId);
    const context = profile
      ? `Profile: goals=${profile.top_goals.join(',')}, peak=${profile.productivity_peak}, risk=${profile.risk_profile}`
      : 'No profile yet';

    const answer = await this.ai.generate(
      'twin_model_generation',
      TWIN_SYSTEM_PROMPT,
      `Given this user profile: ${context}\nQuestion: ${question}\nReturn JSON: {"prediction": "...", "confidence": 0.0-1.0, "reasoning": "..."}`,
      { temperature: 0.2, maxTokens: 300 },
    );

    let parsed: any = {};
    try { parsed = JSON.parse(answer.replace(/```json\n?|\n?```/g, '')); } catch {}

    const prediction: Omit<DigitalTwinPrediction, 'id' | 'user_id' | 'profile_id' | 'created_at'> = {
      prediction_type:       'NEXT_FOCUS',
      prediction:            parsed.prediction ?? answer,
      confidence:            Math.min(1, Math.max(0, parsed.confidence ?? 0.6)),
      evidence:              [{ description: parsed.reasoning ?? question, weight: 0.8, source: 'ai_inference' }],
      supporting_node_ids:   [],
      supporting_memory_ids: [],
      expires_at:            new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
    };

    return this.repo.savePrediction(userId, profile?.id ?? userId, prediction);
  }

  async predictPriority(userId: string): Promise<DigitalTwinPrediction> {
    const [profile, nodes] = await Promise.all([
      this.repo.getProfile(userId),
      this.graphService.getMostImportantNodes(userId, 10),
    ]);

    const topNode = nodes[0];
    const evidence: PredictionEvidence[] = nodes.slice(0, 3).map(n => ({
      description: `${n.name} (importance: ${n.importance_score.toFixed(2)})`,
      weight: n.importance_score,
      source: 'knowledge_graph',
    }));

    const prediction: Omit<DigitalTwinPrediction, 'id' | 'user_id' | 'profile_id' | 'created_at'> = {
      prediction_type:       'LIKELY_PRIORITY',
      prediction:            topNode ? `Most likely to prioritize: ${topNode.name}` : 'Insufficient data',
      confidence:            topNode ? Math.min(0.9, topNode.importance_score) : 0.3,
      evidence,
      supporting_node_ids:   nodes.slice(0, 3).map(n => n.id),
      supporting_memory_ids: [],
      expires_at:            new Date(Date.now() + 6 * 60 * 60_000).toISOString(),
    };

    return this.repo.savePrediction(userId, profile?.id ?? userId, prediction);
  }

  async predictDecision(userId: string, scenario: string): Promise<DigitalTwinPrediction> {
    return this.predictPreference(userId, `Given scenario: ${scenario}, what decision would this person most likely make?`);
  }

  // ---- Private helpers -------------------------------------

  private async extractTraits(userId: string, profileId: string, observations: any[], decisions: any[]): Promise<DigitalTwinTrait[]> {
    const traits: DigitalTwinTrait[] = [];

    // Work style from observation categories
    const catCounts: Record<string, number> = {};
    for (const obs of observations) {
      for (const cat of (obs.categories ?? [])) catCounts[cat] = (catCounts[cat] ?? 0) + 1;
    }
    const topCat = Object.entries(catCounts).sort((a, b) => b[1] - a[1])[0];
    if (topCat) {
      traits.push(await this.repo.upsertTrait(userId, profileId, {
        category: 'WORK_STYLE', trait_name: 'dominant_focus_area',
        trait_value: topCat[0], confidence: Math.min(0.95, topCat[1] / observations.length),
        evidence_count: topCat[1], source_types: ['observations'],
      }));
    }

    // Decision making style
    if (decisions.length >= 3) {
      const avgConf = decisions.reduce((s: number, d: any) => s + (d.confidence_score ?? 0.5), 0) / decisions.length;
      traits.push(await this.repo.upsertTrait(userId, profileId, {
        category: 'DECISION_MAKING', trait_name: 'decision_confidence',
        trait_value: avgConf > 0.7 ? 'high' : avgConf > 0.4 ? 'medium' : 'low',
        confidence: 0.8, evidence_count: decisions.length, source_types: ['decisions'],
      }));
    }

    return traits;
  }

  private async generatePredictions(
    userId: string, profile: DigitalTwinProfile,
    nodes: any[], observations: any[],
  ): Promise<DigitalTwinPrediction[]> {
    const predictions: DigitalTwinPrediction[] = [];

    // Next focus prediction from top graph node
    if (nodes.length > 0) {
      const top = nodes[0];
      predictions.push(await this.repo.savePrediction(userId, profile.id, {
        prediction_type: 'NEXT_FOCUS',
        prediction: `Most likely to focus on: ${top.name}`,
        confidence: Math.min(0.85, top.importance_score),
        evidence: [{ description: `${top.name} has highest importance score`, weight: top.importance_score, source: 'knowledge_graph' }],
        supporting_node_ids: [top.id],
        supporting_memory_ids: top.source_memory_ids ?? [],
        expires_at: new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
      }));
    }

    // Work time preference
    if (profile.productivity_peak) {
      predictions.push(await this.repo.savePrediction(userId, profile.id, {
        prediction_type: 'PREFERRED_WORK_TIME',
        prediction: `Prefers working in the ${profile.productivity_peak}`,
        confidence: 0.75,
        evidence: [{ description: 'Derived from activity observation timestamps', weight: 0.75, source: 'observations' }],
        supporting_node_ids: [],
        supporting_memory_ids: [],
        expires_at: null,
      }));
    }

    return predictions;
  }
}
