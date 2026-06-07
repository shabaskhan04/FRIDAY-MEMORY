// ============================================================
// routes/ingestion.ts
// ============================================================
import type { FastifyInstance } from 'fastify';
import { getFridayUserId }      from '../lib/supabase';
import { getIngestionService }  from '../lib/intelligence';
import { SyncSchema }           from '../modules/ingestion-engine/ingestion.schemas';

export async function ingestionRoutes(app: FastifyInstance): Promise<void> {
  app.post('/ingestion/source', async (req, reply) => {
    try {
      const source = await getIngestionService().createSource(getFridayUserId(), req.body as any);
      return reply.code(201).send(source);
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : 'Failed' });
    }
  });

  app.get('/ingestion/source', async (_req, reply) => {
    try {
      return reply.send(await getIngestionService().listSources(getFridayUserId()));
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : 'Failed' });
    }
  });

  app.post('/ingestion/sync', async (req, reply) => {
    try {
      const { source_id } = SyncSchema.parse(req.body);
      const result = await getIngestionService().syncSource(getFridayUserId(), source_id);
      return reply.send(result);
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : 'Failed' });
    }
  });

  app.get('/ingestion/history', async (req, reply) => {
    try {
      const { source_id, limit } = req.query as { source_id?: string; limit?: string };
      if (!source_id) return reply.code(400).send({ error: 'source_id required' });
      const runs = await getIngestionService().getHistory(getFridayUserId(), source_id, limit ? +limit : 20);
      return reply.send(runs);
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : 'Failed' });
    }
  });

  app.get('/ingestion/health', async (_req, reply) => {
    try {
      return reply.send(await getIngestionService().getSourceHealth(getFridayUserId()));
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : 'Failed' });
    }
  });
}
