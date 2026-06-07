import type { FastifyInstance } from "fastify";
import { getReviewService, getGraphService } from "../lib/intelligence";
import { getFridayUserId } from "../lib/supabase";

export async function reviewRoutes(app: FastifyInstance): Promise<void> {
  // GET /review/latest — fetch the most recent stored review
  app.get("/review/latest", async (_req, reply) => {
    try {
      const review = await getReviewService().getLatestReview(getFridayUserId());
      if (!review) return reply.code(404).send({ error: "No review found." });
      return reply.send(review);
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : "Failed." });
    }
  });

  // POST /review/generate — build context from graph and generate a strategic review
  app.post("/review/generate", async (_req, reply) => {
    try {
      const userId = getFridayUserId();
      // Assemble ReviewContext from top graph entities
      const entities = await getGraphService().getMostImportantNodes(userId, 50);
      const ctx = {
        user_id: userId,
        period_start: new Date(Date.now() - 7 * 86_400_000),
        period_end: new Date(),
        entities: entities.map(e => ({
          id:                     e.id,
          name:                   e.name,
          node_type:              e.node_type,
          importance_score:       e.importance_score,
          attention_score:        e.importance_score,       // proxy
          goal_alignment_score:   (e as any).goal_alignment_score ?? 0.5,
          causal_influence_score: 0.5,
          decision_success_rate:  0.5,
          days_since_last_mention: Math.floor(
            (Date.now() - new Date(e.last_mentioned_at).getTime()) / 86_400_000,
          ),
          edge_count:    0,
          mention_count: e.mention_count,
        })),
      };
      const review = await getReviewService().generateStrategicReview(ctx, "manual");
      return reply.send(review);
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : "Failed." });
    }
  });
}
