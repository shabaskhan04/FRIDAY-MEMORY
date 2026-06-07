import type { FastifyInstance } from 'fastify';
import { getGraphService } from '../../lib/intelligence';
import { getFridayUserId } from '../../lib/supabase';

export async function graphProfileRoutes(app: FastifyInstance): Promise<void> {
  // GET /graph/profile/:name  — e.g. /graph/profile/John
  app.get<{ Params: { name: string } }>('/graph/profile/:name', async (request, reply) => {
    const { name } = request.params;
    if (!name?.trim()) return reply.code(400).send({ error: 'name is required' });

    const profile = await getGraphService().getEntityProfile(getFridayUserId(), name.trim());
    if (!profile) return reply.code(404).send({ error: `Entity "${name}" not found in graph` });

    return reply.send(profile);
  });
}
