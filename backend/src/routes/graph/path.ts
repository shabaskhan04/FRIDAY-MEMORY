import type { FastifyInstance } from 'fastify';
import { getGraphService } from '../../lib/intelligence';
import { getFridayUserId } from '../../lib/supabase';
import { z } from 'zod';

const PathQuerySchema = z.object({
  source:    z.string().min(1),
  target:    z.string().min(1),
  max_depth: z.coerce.number().int().min(1).max(10).default(6),
});

export async function graphPathRoutes(app: FastifyInstance): Promise<void> {
  // GET /graph/path?source=Sarah&target=Khan+Designs
  app.get('/graph/path', async (request, reply) => {
    const parsed = PathQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'source and target are required' });
    }
    const { source, target, max_depth } = parsed.data;

    const result = await getGraphService().findPath(
      getFridayUserId(), source, target, max_depth,
    );

    return reply.send(result);
  });

  // POST /graph/path  { source, target, max_depth? }
  app.post<{ Body: z.infer<typeof PathQuerySchema> }>('/graph/path', async (request, reply) => {
    const parsed = PathQuerySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'source and target are required' });
    }
    const { source, target, max_depth } = parsed.data;

    const result = await getGraphService().findPath(
      getFridayUserId(), source, target, max_depth,
    );

    return reply.send(result);
  });
}
