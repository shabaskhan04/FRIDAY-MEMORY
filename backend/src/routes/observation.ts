import type { FastifyInstance } from "fastify";
import { getObservationService } from "../lib/intelligence";
import { getFridayUserId } from "../lib/supabase";

export async function observationRoutes(app: FastifyInstance): Promise<void> {
  app.get("/observation/recent", async (_req, reply) => {
    try {
      const obs = await getObservationService().listRecent(getFridayUserId(), 50);
      return reply.send(obs);
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : "Failed." });
    }
  });

  app.post<{ Body: { source: string; event_type: string; title: string; description?: string } }>(
    "/observation",
    async (request, reply) => {
      const { source, event_type, title, description } = request.body;
      if (!source || !event_type || !title)
        return reply.code(400).send({ error: "source, event_type, title required." });
      try {
        const obs = await getObservationService().observe({
          user_id: getFridayUserId(),
          source: source as any,
          event_type,
          title,
          description,
        });
        return reply.code(201).send(obs);
      } catch (err) {
        return reply.code(500).send({ error: err instanceof Error ? err.message : "Failed." });
      }
    },
  );
}
