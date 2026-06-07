// ============================================================
// routes/twin.ts
// ============================================================
import type { FastifyInstance } from 'fastify';
import { getFridayUserId }      from '../lib/supabase';
import { getDigitalTwinService } from '../lib/intelligence';

export async function twinRoutes(app: FastifyInstance): Promise<void> {
  app.get('/twin/profile', async (_req, reply) => {
    try {
      const profile = await getDigitalTwinService().getProfile(getFridayUserId());
      if (!profile) return reply.code(404).send({ error: 'No profile built yet. POST /twin/rebuild first.' });
      return reply.send(profile);
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : 'Failed' });
    }
  });

  app.get('/twin/traits', async (_req, reply) => {
    try {
      const service = getDigitalTwinService();
      // traits are part of self-model; access via repo through service
      const model = await service.generateSelfModel(getFridayUserId());
      return reply.send(model.traits);
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : 'Failed' });
    }
  });

  app.post('/twin/rebuild', async (_req, reply) => {
    try {
      const model = await getDigitalTwinService().generateSelfModel(getFridayUserId());
      return reply.send(model);
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : 'Failed' });
    }
  });

  app.post('/twin/predict', async (req, reply) => {
    try {
      const { type, question, scenario } = (req.body as any) ?? {};
      const userId = getFridayUserId();
      const svc = getDigitalTwinService();

      let prediction;
      if (type === 'priority') {
        prediction = await svc.predictPriority(userId);
      } else if (type === 'decision') {
        if (!scenario) return reply.code(400).send({ error: 'scenario required for decision prediction' });
        prediction = await svc.predictDecision(userId, scenario);
      } else {
        if (!question) return reply.code(400).send({ error: 'question required' });
        prediction = await svc.predictPreference(userId, question);
      }
      return reply.send(prediction);
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : 'Failed' });
    }
  });
}
