import type { FastifyInstance } from 'fastify';
import { getFridayUserId } from '../lib/supabase';
import { getActivityService } from '../lib/intelligence';

export async function activityRoutes(app: FastifyInstance): Promise<void> {
  // GET /activities — List recent activities/clusters
  app.get('/activities', async (request, reply) => {
    try {
      const userId = getFridayUserId();
      const query = request.query as { limit?: string };
      const limit = query.limit ? parseInt(query.limit, 10) : 50;
      const activities = await getActivityService().listRecent(userId, limit);
      return reply.send(activities);
    } catch (err) {
      console.error('[activities] GET error:', err);
      return reply.code(500).send({ error: err instanceof Error ? err.message : 'Failed to fetch activities.' });
    }
  });

  // GET /activities/timeline — Get recent activity timeline (7 days)
  app.get('/activities/timeline', async (request, reply) => {
    try {
      const userId = getFridayUserId();
      const query = request.query as { days?: string };
      const days = query.days ? parseInt(query.days, 10) : 7;
      const timeline = await getActivityService().getRecentTimeline(userId, days);
      return reply.send(timeline);
    } catch (err) {
      console.error('[activities] GET timeline error:', err);
      return reply.code(500).send({ error: err instanceof Error ? err.message : 'Failed to fetch activity timeline.' });
    }
  });
}
