// ============================================================
// observation.processor.ts — Processing pipeline
// Runs classify → score → persist on raw input.
// No external calls. No LLM. Pure transformation.
// ============================================================
import type { ObservationRepository } from './observation.repository';
import type { ObservationClassifier } from './observation-classifier';
import type { Observation, CreateObservationInput } from './observation.types';
import { calculateImportanceScore } from './observation.scoring';
import { CreateObservationSchema } from './observation.schemas';
import { getSignalQuality } from '../activity-engine/activity.scoring';

export interface ProcessingContext {
  sourceFrequencyInWindow?:   number;
  entityImportanceScores?:    number[];
  goalAlignedEntityCount?:    number;
  projectRelatedEntityCount?: number;
}

export class ObservationProcessor {
  constructor(
    private readonly repo:       ObservationRepository,
    private readonly classifier: ObservationClassifier,
  ) {}

  /**
   * process() — validate → classify → score → persist.
   * Single entry point for all observation ingestion.
   */
  async process(
    raw: CreateObservationInput,
    ctx: ProcessingContext = {},
  ): Promise<Observation> {
    const validated = CreateObservationSchema.parse(raw);

    // Populate source_node_id and target_node_id if missing in metadata but related_entities exists
    const metadata = { ...(validated.metadata || {}) };
    let sourceNodeId = metadata.source_node_id as string | undefined;
    let targetNodeId = metadata.target_node_id as string | undefined;

    if (!sourceNodeId || !targetNodeId) {
      const related = validated.related_entities || [];
      const db = (this.repo as any).db;
      if (db && related.length > 0) {
        try {
          const { data: nodes } = await db
            .from('graph_nodes')
            .select('id, name')
            .eq('user_id', validated.user_id)
            .in('name', related)
            .eq('is_archived', false);

          if (nodes && nodes.length > 0) {
            if (!sourceNodeId) {
              sourceNodeId = nodes[0].id;
            }
            if (nodes.length > 1) {
              if (!targetNodeId) {
                targetNodeId = nodes[1].id;
              }
            } else {
              // If the memory mentions only one entity, set target_node_id to the user's own "Self" node ("You")
              const { data: existingSelf } = await db
                .from('graph_nodes')
                .select('id')
                .eq('user_id', validated.user_id)
                .eq('name', 'You')
                .eq('node_type', 'PERSON')
                .eq('is_archived', false)
                .maybeSingle();

              if (existingSelf) {
                targetNodeId = existingSelf.id;
              } else {
                const { data: createdSelf } = await db
                  .from('graph_nodes')
                  .insert({
                    user_id: validated.user_id,
                    name: 'You',
                    node_type: 'PERSON',
                    aliases: ['Me', 'Self'],
                    metadata: {},
                  })
                  .select('id')
                  .single();

                if (createdSelf) {
                  targetNodeId = createdSelf.id;
                }
              }
            }
          }
        } catch (err) {
          console.error("[ObservationProcessor] Failed to resolve graph nodes for metadata:", err);
        }
      }
    }

    if (sourceNodeId) metadata.source_node_id = sourceNodeId;
    if (targetNodeId) metadata.target_node_id = targetNodeId;

    // 1. Classify
    const classification = await this.classifier.classify(
      validated.source,
      validated.title,
      validated.description ?? null,
    );

    // 2. Score
    const scoring = calculateImportanceScore(
      {
        source:           validated.source,
        title:            validated.title,
        description:      validated.description ?? null,
        related_entities: validated.related_entities,
      },
      {
        sourceFrequencyInWindow:   ctx.sourceFrequencyInWindow   ?? 1,
        entityImportanceScores:    ctx.entityImportanceScores    ?? [],
        goalAlignedEntityCount:    ctx.goalAlignedEntityCount    ?? 0,
        projectRelatedEntityCount: ctx.projectRelatedEntityCount ?? 0,
      },
    );

    // 3. Persist with enriched fields
    const savedObs = await this.repo.create({
      ...validated,
      metadata,
      categories:       validated.categories.length ? validated.categories : classification.categories,
      importance_score: validated.importance_score !== 0.5
        ? validated.importance_score  // caller override
        : scoring.final_score,
      confidence_score: Math.min(validated.confidence_score, classification.confidence),
    } as CreateObservationInput);

    // 4. Trigger activity pipeline (async/non-blocking)
    try {
      const unprocessed = await this.repo.listUnprocessed(savedObs.user_id, 50);
      if (unprocessed.length > 0) {
        const { getActivityService } = await import('../../lib/intelligence');
        const activityService = getActivityService();
        await activityService.processObservations(savedObs.user_id, unprocessed);
        for (const o of unprocessed) {
          await this.repo.markProcessed(o.id, savedObs.user_id);
        }
      }
    } catch (err) {
      console.error("[ObservationProcessor] Failed to trigger activity clustering:", err);
    }

    return savedObs;
  }

  /**
   * processBatch() — process multiple observations in sequence.
   * Builds a frequency window from the batch for accurate rarity scoring.
   */
  async processBatch(
    inputs: CreateObservationInput[],
    ctx: ProcessingContext = {},
  ): Promise<Observation[]> {
    // Build source frequency from the batch itself
    const freqMap = new Map<string, number>();
    for (const i of inputs) freqMap.set(i.source, (freqMap.get(i.source) ?? 0) + 1);

    const results: Observation[] = [];
    for (const input of inputs) {
      const obs = await this.process(input, {
        ...ctx,
        sourceFrequencyInWindow: freqMap.get(input.source) ?? 1,
      });
      results.push(obs);
    }
    return results;
  }

  /**
   * reprocess() — re-run classification + scoring on an existing observation.
   * Useful when context changes (new entity importance scores available).
   */
  async reprocess(id: string, userId: string, ctx: ProcessingContext = {}): Promise<Observation> {
    const obs = await this.repo.getById(id, userId);
    if (!obs) throw new Error(`Observation ${id} not found`);

    const classification = await this.classifier.classify(obs.source, obs.title, obs.description);
    const scoring = calculateImportanceScore(obs, {
      sourceFrequencyInWindow:   ctx.sourceFrequencyInWindow   ?? 1,
      entityImportanceScores:    ctx.entityImportanceScores    ?? [],
      goalAlignedEntityCount:    ctx.goalAlignedEntityCount    ?? 0,
      projectRelatedEntityCount: ctx.projectRelatedEntityCount ?? 0,
    });

    return this.repo.update(id, userId, {
      categories:          classification.categories,
      importance_score:    scoring.final_score,
      confidence_score:    classification.confidence,
      signal_quality_score: getSignalQuality(obs.source).score,
      is_processed:        true,
    });
  }

  /**
   * drainUnprocessed() — pick up unprocessed observations and reprocess them.
   * Called as a background job or on-demand.
   */
  async drainUnprocessed(userId: string, limit = 50): Promise<number> {
    const pending = await this.repo.listUnprocessed(userId, limit);
    for (const obs of pending) {
      await this.reprocess(obs.id, userId);
      await this.repo.markProcessed(obs.id, userId);
    }
    return pending.length;
  }
}
