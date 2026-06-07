// ============================================================
// routes/causal.ts
// ============================================================
import type { FastifyInstance } from 'fastify';
import { getFridayUserId }       from '../lib/supabase';
import { getCausalReasoningService } from '../lib/intelligence';

export async function causalRoutes(app: FastifyInstance): Promise<void> {
  app.get('/causal/patterns', async (_req, reply) => {
    try {
      const patterns = await getCausalReasoningService().discoverCausalPatterns(getFridayUserId());
      return reply.send(patterns);
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : 'Failed' });
    }
  });

  app.get('/causal/blockers', async (_req, reply) => {
    try {
      return reply.send(await getCausalReasoningService().findGoalBlockers(getFridayUserId()));
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : 'Failed' });
    }
  });

  app.get('/causal/accelerators', async (_req, reply) => {
    try {
      return reply.send(await getCausalReasoningService().findGoalAccelerators(getFridayUserId()));
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : 'Failed' });
    }
  });

  app.post('/causal/predict', async (req, reply) => {
    try {
      const { condition } = (req.body as any) ?? {};
      if (!condition) return reply.code(400).send({ error: 'condition required' });
      const prediction = await getCausalReasoningService().predictOutcome(getFridayUserId(), condition);
      return reply.send(prediction);
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : 'Failed' });
    }
  });
}
