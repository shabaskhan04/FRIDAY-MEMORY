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

    // 1. Classify
    const classification = this.classifier.classify(
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
    return this.repo.create({
      ...validated,
      categories:       validated.categories.length ? validated.categories : classification.categories,
      importance_score: validated.importance_score !== 0.5
        ? validated.importance_score  // caller override
        : scoring.final_score,
      confidence_score: Math.min(validated.confidence_score, classification.confidence),
    } as CreateObservationInput);
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

    const classification = this.classifier.classify(obs.source, obs.title, obs.description);
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
