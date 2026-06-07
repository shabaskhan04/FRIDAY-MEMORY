import type { FastifyInstance } from 'fastify';
import { getGraphService } from '../../lib/intelligence';
import { getFridayUserId } from '../../lib/supabase';

export async function graphEvidenceRoutes(app: FastifyInstance): Promise<void> {
  // GET /graph/evidence/node/:name — memories that support an entity
  app.get<{ Params: { name: string } }>('/graph/evidence/node/:name', async (request, reply) => {
    const result = await getGraphService().getNodeEvidence(getFridayUserId(), request.params.name);
    if (!result) return reply.code(404).send({ error: 'Entity not found' });
    return reply.send(result);
  });

  // GET /graph/evidence/edge/:id — memories that support a relationship
  app.get<{ Params: { id: string } }>('/graph/evidence/edge/:id', async (request, reply) => {
    const result = await getGraphService().getEdgeEvidence(getFridayUserId(), request.params.id);
    if (!result) return reply.code(404).send({ error: 'Edge not found' });
    return reply.send(result);
  });

  // GET /graph/evidence/memory/:id — what graph nodes/edges came from a memory
  app.get<{ Params: { id: string } }>('/graph/evidence/memory/:id', async (request, reply) => {
    const result = await getGraphService().getMemoryGraphContext(getFridayUserId(), request.params.id);
    return reply.send(result);
  });
}
