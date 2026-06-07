// ============================================================
// decision.schemas.ts
// ============================================================
import { z } from 'zod';

export const DecisionStatusSchema = z.enum(['PLANNED', 'ACTIVE', 'COMPLETED', 'ABANDONED', 'FAILED']);

export const DecisionRelationshipTypeSchema = z.enum([
  'DECIDES_ON', 'AFFECTS', 'SUPPORTS', 'BLOCKS', 'RESULTED_IN',
]);

export const CreateDecisionSchema = z.object({
  user_id:                       z.string().min(1),
  title:                         z.string().min(1).max(500),
  description:                   z.string().max(5000).optional(),
  decision_type:                 z.string().default('GENERAL'),
  reasoning:                     z.string().max(5000).optional(),
  expected_outcome:              z.string().max(2000).optional(),
  expected_success_probability:  z.number().min(0).max(1).default(0.5),
  confidence_score:              z.number().min(0).max(1).default(0.5),
  decision_date:                 z.string().datetime().optional(),
  review_date:                   z.string().datetime().optional(),
  entity_node_ids:               z.array(z.string().uuid()).optional(),
});

export const UpdateDecisionSchema = z.object({
  title:                         z.string().min(1).max(500).optional(),
  description:                   z.string().max(5000).optional(),
  reasoning:                     z.string().max(5000).optional(),
  expected_outcome:              z.string().max(2000).optional(),
  expected_success_probability:  z.number().min(0).max(1).optional(),
  actual_outcome:                z.string().max(2000).optional(),
  status:                        DecisionStatusSchema.optional(),
  confidence_score:              z.number().min(0).max(1).optional(),
  review_date:                   z.string().datetime().optional(),
});

export const EvaluateDecisionSchema = z.object({
  success_score:  z.number().min(0).max(1),
  accuracy_score: z.number().min(0).max(1),
  lessons:        z.array(z.string()).default([]),
  notes:          z.string().max(2000).optional(),
});
