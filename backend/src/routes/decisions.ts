import type { FastifyInstance } from 'fastify';
import { getFridayUserId } from '../lib/supabase';
import { getDecisionService } from '../lib/intelligence';

export async function decisionsRoutes(app: FastifyInstance): Promise<void> {
  // GET /decisions — List all decisions for the user
  app.get('/decisions', async (_request, reply) => {
    try {
      const userId = getFridayUserId();
      const decisions = await getDecisionService().listDecisions(userId);
      return reply.send({ decisions });
    } catch (err) {
      console.error('[decisions] GET error:', err);
      return reply.code(500).send({ error: err instanceof Error ? err.message : 'Failed to fetch decisions.' });
    }
  });

  // POST /decisions — Log a new decision
  app.post('/decisions', async (request, reply) => {
    try {
      const userId = getFridayUserId();
      const body = request.body as any;

      const decision = await getDecisionService().createDecision({
        user_id: userId,
        title: body.title,
        description: body.description,
        decision_type: body.decision_type ?? 'GENERAL',
        reasoning: body.reasoning,
        expected_outcome: body.expected_outcome,
        expected_success_probability: typeof body.expected_success_probability === 'number' 
          ? body.expected_success_probability 
          : 0.5,
        confidence_score: typeof body.confidence_score === 'number' 
          ? body.confidence_score 
          : 0.5,
        entity_node_ids: Array.isArray(body.entity_node_ids) ? body.entity_node_ids : [],
      });

      return reply.code(201).send(decision);
    } catch (err) {
      console.error('[decisions] POST create error:', err);
      return reply.code(400).send({ error: err instanceof Error ? err.message : 'Failed to log decision.' });
    }
  });

  // POST /decisions/:id/evaluate — Resolve and score a decision outcome
  app.post('/decisions/:id/evaluate', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const userId = getFridayUserId();
      const body = request.body as any;

      const success = body.success !== undefined ? Boolean(body.success) : true;
      const success_score = typeof body.success_score === 'number' ? body.success_score : (success ? 1.0 : 0.0);
      const accuracy_score = typeof body.accuracy_score === 'number' ? body.accuracy_score : 0.8;

      const evaluation = await getDecisionService().evaluateDecision(
        userId,
        id,
        {
          success_score,
          accuracy_score,
          lessons: Array.isArray(body.lessons) ? body.lessons : (body.lessons ? [body.lessons] : []),
          notes: body.notes,
        }
      );

      return reply.send(evaluation);
    } catch (err) {
      console.error('[decisions] POST evaluate error:', err);
      return reply.code(400).send({ error: err instanceof Error ? err.message : 'Failed to evaluate decision.' });
    }
  });
}
