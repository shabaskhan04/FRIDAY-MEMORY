// ============================================================
// intelligence.ts — Singleton wiring for the intelligence layer
// ============================================================

import { createServiceClient, getFridayUserId } from './supabase';
import { generateEmbedding } from './embeddings';
import { createEmbeddingAdapter } from '../modules/ai-engine/embeddings.adapter';
import { AIRouter } from '../modules/ai-engine/ai-router';
import { GraphRepository } from '../modules/knowledge-graph/graph.repository';
import { GraphExtractor } from '../modules/knowledge-graph/graph.extractor';
import { GraphMerger } from '../modules/knowledge-graph/graph.merger';
import { GraphSearch } from '../modules/knowledge-graph/graph.search';
import { GraphTraversal } from '../modules/knowledge-graph/graph.traversal';
import { GraphInsights } from '../modules/knowledge-graph/graph.insights';
import { GraphService } from '../modules/knowledge-graph/graph.service';
import { ObservationRepository } from '../modules/observation-engine/observation.repository';
import { ObservationProcessor } from '../modules/observation-engine/observation.processor';
import { ObservationClassifier } from '../modules/observation-engine/observation-classifier';
import { ObservationInsights } from '../modules/observation-engine/observation-insights';
import { ObservationTimeline } from '../modules/observation-engine/observation.timeline';
import { ObservationService } from '../modules/observation-engine/observation.service';
import { ActivityRepository } from '../modules/activity-engine/activity.repository';
import { CorrelationEngine } from '../modules/activity-engine/correlation.engine';
import { TimelineEngine } from '../modules/activity-engine/timeline.engine';
import { ActivityInsights } from '../modules/activity-engine/activity-insights';
import { ActivityService } from '../modules/activity-engine/activity.service';
import { ReviewService } from '../modules/review-engine/review.service';
import { FocusEngine } from '../modules/review-engine/focus.engine';
import { RiskEngine } from '../modules/review-engine/risk.engine';
import { PriorityEngine } from '../modules/review-engine/priority.engine';
import { RecommendationEngine } from '../modules/review-engine/recommendation.engine';
import { IngestionRepository } from '../modules/ingestion-engine/ingestion.repository';
import { IngestionService } from '../modules/ingestion-engine/ingestion.service';
import { IngestionNormalizer } from '../modules/ingestion-engine/normalizer';
import { ConnectorRegistry } from '../modules/ingestion-engine/connector.registry';
import { DigitalTwinRepository } from '../modules/digital-twin/digital-twin.repository';
import { DigitalTwinService } from '../modules/digital-twin/digital-twin.service';
import { CausalReasoningRepository } from '../modules/causal-reasoning/causal-reasoning.repository';
import { CausalReasoningService } from '../modules/causal-reasoning/causal-reasoning.service';
import { CausalRepository } from '../modules/causal-engine/causal.repository';
import { DecisionRepository } from '../modules/decision-engine/decision.repository';
import { DecisionEvaluationEngine } from '../modules/decision-engine/decision-evaluation.engine';
import { DecisionInsights } from '../modules/decision-engine/decision.insights';
import { DecisionTimelineService } from '../modules/decision-engine/decision.timeline';
import { DecisionService } from '../modules/decision-engine/decision.service';
import { getGroqClient } from './groq';
import { loadDailyCountsFromDb } from '../modules/ai-engine/ai-usage';

// ---- Lazy singleton state ----------------------------------

let _graphService:          GraphService          | null = null;
let _aiRouter:              AIRouter              | null = null;
let _observationService:    ObservationService    | null = null;
let _activityService:       ActivityService       | null = null;
let _reviewService:         ReviewService         | null = null;
let _ingestionService:      IngestionService      | null = null;
let _digitalTwinService:    DigitalTwinService    | null = null;
let _causalReasoningService: CausalReasoningService | null = null;
let _decisionService:       DecisionService       | null = null;

function build() {
  const db = createServiceClient();

  const embedFn = async (text: string): Promise<number[]> => {
    const vec = await generateEmbedding(text);
    if (!vec) throw new Error('[intelligence] embedding generation failed');
    return vec;
  };

  // ── Knowledge Graph ───────────────────────────────────────
  const repo      = new GraphRepository(db);
  const traversal = new GraphTraversal(repo);
  const merger    = new GraphMerger(repo);
  const insights  = new GraphInsights(repo);
  const search    = new GraphSearch(repo, traversal, embedFn);
  const groq      = getGroqClient();
  const openai    = createEmbeddingAdapter();
  const router    = new AIRouter(groq as unknown as import('../modules/ai-engine/ai-router').GroqClient, openai, db, getFridayUserId());
  const extractor = new GraphExtractor(router);
  const graphService = new GraphService(repo, extractor, merger, search, traversal, insights, embedFn);

  // ── Observation Engine ────────────────────────────────────
  const obsRepo       = new ObservationRepository(db);
  const classifier    = new ObservationClassifier();
  const processor     = new ObservationProcessor(obsRepo, classifier);
  const obsInsights   = new ObservationInsights(obsRepo);
  const obsTimeline   = new ObservationTimeline(obsRepo);
  const observationService = new ObservationService(obsRepo, processor, obsInsights, obsTimeline);

  // ── Activity Engine ───────────────────────────────────────
  const actRepo      = new ActivityRepository(db);
  const correlator   = new CorrelationEngine();
  const actTimeline  = new TimelineEngine(actRepo);
  const actInsights  = new ActivityInsights(actRepo, actTimeline);
  const activityService = new ActivityService(actRepo, correlator, actTimeline, actInsights);

  // ── Review Engine ─────────────────────────────────────────
  const reviewService = new ReviewService(
    db,
    new FocusEngine(),
    new RiskEngine(),
    new PriorityEngine(),
    new RecommendationEngine(),
  );

  // ── Decision Engine ───────────────────────────────────────
  const decRepo      = new DecisionRepository(db);
  const decEvaluator = new DecisionEvaluationEngine(decRepo);
  const decInsights  = new DecisionInsights(decRepo);
  const decTimeline  = new DecisionTimelineService(decRepo);
  const decisionService = new DecisionService(decRepo, decEvaluator, decInsights, decTimeline);

  // ── Ingestion Engine ──────────────────────────────────────
  const ingestionRepo  = new IngestionRepository(db);
  const registry       = ConnectorRegistry.createDefault();
  const normalizer     = new IngestionNormalizer();
  const ingestionService = new IngestionService(ingestionRepo, registry, normalizer, observationService);

  // ── Digital Twin ──────────────────────────────────────────
  const twinRepo    = new DigitalTwinRepository(db);
  const digitalTwinService = new DigitalTwinService(twinRepo, router, graphService, observationService, decisionService);

  // ── Causal Reasoning ─────────────────────────────────────
  const causalRepo    = new CausalRepository(db);
  const causalReasoningRepo = new CausalReasoningRepository(db);
  const causalReasoningService = new CausalReasoningService(causalReasoningRepo, causalRepo, obsRepo, router);

  // Restore today's AI usage counters so budget limits survive restarts
  loadDailyCountsFromDb(db, getFridayUserId()).catch(() => {});

  return {
    graphService, aiRouter: router, observationService, activityService, reviewService,
    ingestionService, digitalTwinService, causalReasoningService, decisionService,
  };
}

function getInstance() {
  if (!_graphService) {
    ({
      graphService: _graphService, aiRouter: _aiRouter,
      observationService: _observationService, activityService: _activityService,
      reviewService: _reviewService, ingestionService: _ingestionService,
      digitalTwinService: _digitalTwinService, causalReasoningService: _causalReasoningService,
      decisionService: _decisionService,
    } = build());
  }
  return {
    _graphService, _aiRouter, _observationService, _activityService, _reviewService,
    _ingestionService, _digitalTwinService, _causalReasoningService, _decisionService,
  };
}

export function getGraphService():            GraphService            { return getInstance()._graphService!; }
export function getAIRouter():                AIRouter                { return getInstance()._aiRouter!; }
export function getObservationService():      ObservationService      { return getInstance()._observationService!; }
export function getActivityService():         ActivityService         { return getInstance()._activityService!; }
export function getReviewService():           ReviewService           { return getInstance()._reviewService!; }
export function getIngestionService():        IngestionService        { return getInstance()._ingestionService!; }
export function getDigitalTwinService():      DigitalTwinService      { return getInstance()._digitalTwinService!; }
export function getCausalReasoningService():  CausalReasoningService  { return getInstance()._causalReasoningService!; }
export function getDecisionService():         DecisionService         { return getInstance()._decisionService!; }
