import type { FastifyInstance } from 'fastify';
import { getGraphService } from '../../lib/intelligence';
import { getFridayUserId } from '../../lib/supabase';
import { z } from 'zod';

const PlanSchema = z.object({ query: z.string().min(1) });

export async function graphPlannerRoutes(app: FastifyInstance): Promise<void> {
  // POST /graph/plan  { "query": "Who helps build products I own?" }
  app.post<{ Body: z.infer<typeof PlanSchema> }>('/graph/plan', async (request, reply) => {
    const parsed = PlanSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'query is required' });

    const result = await getGraphService().planQuery(getFridayUserId(), parsed.data.query);
    return reply.send(result);
  });
}
