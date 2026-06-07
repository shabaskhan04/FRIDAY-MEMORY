// ============================================================
// review.schemas.ts
// ============================================================
import { z } from 'zod';

export const EntityContextSchema = z.object({
  id:                      z.string(),
  name:                    z.string(),
  node_type:               z.string(),
  importance_score:        z.number().min(0).max(1),
  attention_score:         z.number().min(0).max(1),
  goal_alignment_score:    z.number().min(0).max(1),
  causal_influence_score:  z.number().min(0).max(1),
  decision_success_rate:   z.number().min(0).max(1),
  days_since_last_mention: z.number().min(0),
  edge_count:              z.number().int().min(0),
  mention_count:           z.number().int().min(0),
});

export const ReviewContextSchema = z.object({
  user_id:      z.string().uuid(),
  period_start: z.date(),
  period_end:   z.date(),
  entities:     z.array(EntityContextSchema).min(1),
});
