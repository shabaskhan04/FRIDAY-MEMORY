// ============================================================
// integration.schemas.ts
// ============================================================
import { z } from 'zod';

export const PipelineStatusSchema = z.enum(['PENDING','RUNNING','COMPLETED','FAILED','SKIPPED']);

export const WorkflowTypeSchema = z.enum([
  'OBSERVATION_INGESTION','DECISION_EVALUATION','WEEKLY_REVIEW','GRAPH_UPDATE','MANUAL',
]);

export const IntegrationEventTypeSchema = z.enum([
  'OBSERVATION_CREATED','ACTIVITY_CREATED','GRAPH_UPDATED',
  'DECISION_CREATED','DECISION_EVALUATED','CAUSAL_LINK_CREATED',
  'STRATEGIC_REVIEW_CREATED','PIPELINE_COMPLETED','PIPELINE_FAILED',
]);

export const IntegrationEventSchema = z.object({
  type:       IntegrationEventTypeSchema,
  user_id:    z.string().uuid(),
  payload:    z.record(z.unknown()),
  emitted_at: z.string().datetime(),
});
