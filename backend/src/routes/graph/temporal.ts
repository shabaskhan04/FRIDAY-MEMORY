import type { FastifyInstance } from 'fastify';
import { getGraphService } from '../../lib/intelligence';
import { getFridayUserId } from '../../lib/supabase';
import { z } from 'zod';

const ChangesSchema = z.object({
  since: z.string().datetime({ message: 'since must be an ISO 8601 datetime' }),
});

export async function graphTemporalRoutes(app: FastifyInstance): Promise<void> {
  // GET /graph/temporal/entity/:name — when did this entity first appear?
  app.get<{ Params: { name: string } }>('/graph/temporal/entity/:name', async (request, reply) => {
    const result = await getGraphService().getEntityFirstSeen(getFridayUserId(), request.params.name);
    if (!result) return reply.code(404).send({ error: 'Entity not found' });
    return reply.send(result);
  });

  // GET /graph/temporal/changes?since=2026-06-01T00:00:00Z
  app.get('/graph/temporal/changes', async (request, reply) => {
    const parsed = ChangesSchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'since (ISO datetime) is required' });
    }
    const result = await getGraphService().getGraphChangesSince(
      getFridayUserId(),
      new Date(parsed.data.since),
    );
    return reply.send(result);
  });
}
