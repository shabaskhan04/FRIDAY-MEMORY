// ============================================================
// causal.schemas.ts
// ============================================================
import { z } from 'zod';

export const CausalRelationshipTypeSchema = z.enum([
  'CAUSED', 'CONTRIBUTED_TO', 'ENABLED', 'PREVENTED', 'ACCELERATED', 'DELAYED',
]);

export const CausalEvidenceSchema = z.object({
  description:      z.string().min(1),
  source_memory_id: z.string().uuid().optional(),
  timestamp:        z.string().datetime(),
  weight:           z.number().min(0).max(1).default(0.5),
});

export const CreateCausalEdgeSchema = z.object({
  user_id:           z.string().uuid(),
  source_node_id:    z.string().uuid(),
  target_node_id:    z.string().uuid(),
  relationship_type: CausalRelationshipTypeSchema,
  causal_strength:   z.number().min(0).max(1),
  confidence:        z.number().min(0).max(1).default(0.8),
  evidence:          z.array(CausalEvidenceSchema).default([]),
  source_memory_ids: z.array(z.string().uuid()).default([]),
}).refine(d => d.source_node_id !== d.target_node_id, {
  message: 'Self-causal loops not allowed',
});
