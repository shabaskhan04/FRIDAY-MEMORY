import type { FastifyInstance } from 'fastify';
import { getGraphService } from '../../lib/intelligence';
import { getFridayUserId } from '../../lib/supabase';
import { z } from 'zod';

const QuerySchema = z.object({
  top: z.coerce.number().int().min(1).max(50).default(10),
});

export async function graphAnalyticsRoutes(app: FastifyInstance): Promise<void> {
  // GET /graph/analytics?top=10
  app.get('/graph/analytics', async (request, reply) => {
    const { top } = QuerySchema.parse(request.query);
    const result = await getGraphService().getGraphAnalytics(getFridayUserId(), top);
    return reply.send(result);
  });

  // GET /graph/analytics/node/:id
  app.get<{ Params: { id: string } }>('/graph/analytics/node/:id', async (request, reply) => {
    const result = await getGraphService().getNodeAnalytics(getFridayUserId(), request.params.id);
    if (!result) return reply.code(404).send({ error: 'Node not found' });
    return reply.send(result);
  });
}
