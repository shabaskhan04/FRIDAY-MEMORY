import type { FastifyInstance } from "fastify";
import { generateEmbedding, toVectorLiteral } from "../../lib/embeddings";
import { createServiceClient } from "../../lib/supabase";
import { analyzeQuery } from "../../lib/queryAnalyzer";
import type { SearchRequestBody, HybridMemoryRow } from "@friday/shared";

const ENTITY_BOOST = 0.4;

export async function memorySearchRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: SearchRequestBody }>("/memory/search", async (request, reply) => {
    const query = request.body.query?.trim() ?? "";
    if (!query) return reply.send({ memories: [] });

    const rawLimit = request.body.limit;
    const limit = typeof rawLimit === "number" && Number.isFinite(rawLimit)
      ? Math.min(Math.max(Math.floor(rawLimit), 1), 50)
      : 20;
    const debug = Boolean(request.body.debug);

    try {
      const supabase = createServiceClient();

      const analysis = await analyzeQuery(query, supabase);
      const { weights, entities } = analysis;

      const embeddingVec = await generateEmbedding(query);
      if (!embeddingVec) {
        return reply.code(500).send({ error: "Failed to generate query embedding." });
      }

      const { data, error } = await supabase.rpc("match_memories_hybrid", {
        query_embedding: toVectorLiteral(embeddingVec),
        query_text: query,
        semantic_weight: weights.semantic,
        keyword_weight: weights.keyword,
        recency_weight: weights.recency,
        match_count: Math.min(limit * 3, 50),
        match_threshold: -1,
      });

      if (error) {
        console.error("[memory/search] hybrid RPC failed:", error);
        return reply.code(500).send({ error: "Search failed.", detail: error.message });
      }

      type RpcRow = {
        id: string; content: string; created_at: string;
        intent_tag: string | null; local_timezone: string | null;
        location_text: string | null;
        semantic_score: number; keyword_score: number;
        recency_score: number; final_score: number;
      };

      const rows = (data ?? []) as RpcRow[];
      const entityNames = entities.map((e) => e.name.toLowerCase());

      const scored: HybridMemoryRow[] = rows.map((row) => {
        const contentLower = row.content.toLowerCase();
        const matched = entityNames.filter((n) => contentLower.includes(n));
        const entityScore = Math.min(matched.length * ENTITY_BOOST, 1.0);
        const finalScore =
          row.semantic_score * weights.semantic +
          row.keyword_score * weights.keyword +
          entityScore * weights.entity +
          row.recency_score * weights.recency;

        return {
          ...row,
          entity_score: entityScore,
          final_score: finalScore,
          similarity: finalScore,
          matched_entities: matched,
        };
      });

      scored.sort((a, b) => b.final_score - a.final_score);
      const results = scored.slice(0, limit);

      const response: Record<string, unknown> = { memories: results };
      if (debug) {
        response.query_analysis = {
          query_type: analysis.queryType,
          entities: analysis.entities,
          weights: analysis.weights,
        };
      }

      return reply.send(response);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Hybrid search failed.";
      console.error("[memory/search] error:", err);
      return reply.code(500).send({ error: message });
    }
  });
}
