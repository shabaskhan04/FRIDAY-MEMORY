import type { FastifyInstance } from "fastify";
import { generateEmbedding, toVectorLiteral } from "../../lib/embeddings";
import { createServiceClient } from "../../lib/supabase";
import { analyzeQuery } from "../../lib/queryAnalyzer";
import { getGraphService, getAIRouter } from "../../lib/intelligence";
import { getFridayUserId } from "../../lib/supabase";
import type { AskRequestBody, AskResponse, CitedMemory } from "@friday/shared";

const ENTITY_BOOST = 0.4;

type ScoredRow = {
  id: string;
  content: string;
  created_at: string;
  intent_tag: string | null;
  local_timezone: string | null;
  location_text: string | null;
  semantic_score: number;
  keyword_score: number;
  recency_score: number;
  final_score: number;
  entity_score: number;
  matched_entities: string[];
};

function buildSystemPrompt(graphSummary?: string): string {
  const graphSection = graphSummary ? `\
## Knowledge Graph (PRIMARY SOURCE — use this first)
${graphSummary}

When the question asks about relationships, connections, or how entities are linked:
- Answer DIRECTLY from the graph relationships above.
- Explicitly name the relationship type (e.g. BUSINESS_PARTNER, OWNS, WORKS_WITH).
- Describe the graph path that connects the entities.
- Do NOT paraphrase graph facts into vague prose.

` : "";

  return `You are Friday, a personal memory assistant.
${graphSection}\
You will also be given a list of the user's memories (numbered with IDs).

Your task:
1. ${graphSummary
    ? "If the Knowledge Graph above contains relevant relationships, answer from the graph FIRST. Use memories only to add supporting detail or context."
    : "Answer the question using ONLY the provided memories. Do not use outside knowledge."}
2. Be direct, warm, and specific — reference concrete details.
3. When memories mention a specific person, project, or topic related to the question, prioritize those.
4. Identify recurring patterns across memories when relevant.
5. Include relevant dates or timeframes when available.
6. At the end of your answer, include a JSON block (and nothing else after it) in this exact format:
   {"cited_ids": ["id1", "id2", ...]}
   Only cite IDs you actually used. Max 5 citations.
7. If neither the graph nor memories contain enough information, say so honestly.

Format: 2-4 sentences of answer, then the JSON block on its own line.`;
}

export async function memoryAskRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: AskRequestBody }>("/memory/ask", async (request, reply) => {
    const query = request.body.query?.trim() ?? "";
    if (!query) return reply.code(400).send({ error: "query is required." });

    try {
      const supabase = createServiceClient();

      const analysis = await analyzeQuery(query, supabase);
      const { weights, entities } = analysis;
      const entityNames = entities.map((e) => e.name.toLowerCase());

      const embeddingResult = await getAIRouter().embed(query);
      const embeddingVec = embeddingResult[0];
      if (!embeddingVec) {
        return reply.code(500).send({ error: "Failed to generate query embedding." });
      }

      const { data, error } = await supabase.rpc("match_memories_hybrid", {
        query_embedding: toVectorLiteral(embeddingVec),
        query_text: query,
        semantic_weight: weights.semantic,
        keyword_weight: weights.keyword,
        recency_weight: weights.recency,
        match_count: 30,
        match_threshold: -1,
      });

      if (error) {
        return reply.code(500).send({ error: "Memory retrieval failed.", detail: error.message });
      }

      type RpcRow = {
        id: string; content: string; created_at: string;
        intent_tag: string | null; local_timezone: string | null;
        location_text: string | null;
        semantic_score: number; keyword_score: number;
        recency_score: number; final_score: number;
      };

      const rows = (data ?? []) as RpcRow[];

      const scored: ScoredRow[] = rows.map((row) => {
        const contentLower = row.content.toLowerCase();
        const matched = entityNames.filter((n) => contentLower.includes(n));
        const entityScore = Math.min(matched.length * ENTITY_BOOST, 1.0);
        const finalScore =
          row.semantic_score * weights.semantic +
          row.keyword_score * weights.keyword +
          entityScore * weights.entity +
          row.recency_score * weights.recency;
        return { ...row, entity_score: entityScore, final_score: finalScore, matched_entities: matched };
      });

      scored.sort((a, b) => b.final_score - a.final_score);
      const memories = scored.slice(0, 10);

      if (memories.length === 0) {
        return reply.send({
          answer: "I don't have any memories that relate to this question yet. Add more memories and I'll be able to help.",
          citations: [],
          cited_ids: [],
          query_type: analysis.queryType,
          entities_detected: entities.map((e) => e.name),
        } satisfies AskResponse);
      }

      const memoriesText = memories
        .map((m, i) => {
          const date = new Date(m.created_at).toLocaleDateString("en-IN", {
            month: "short", day: "numeric", year: "numeric",
          });
          const ents = m.matched_entities.length > 0
            ? ` [mentions: ${m.matched_entities.join(", ")}]`
            : "";
          return `[${i + 1}] ID: ${m.id}\nDate: ${date}${ents}\nType: ${m.intent_tag ?? "memory"}\nContent: ${m.content}`;
        })
        .join("\n\n");

      const entityContext = analysis.entities.length > 0
        ? `\nDetected in query: ${analysis.entities.map((e) => e.name).join(", ")}`
        : "";

      const userPrompt = `Query: "${query}"\nQuery type: ${analysis.queryType}${entityContext}\n\nMEMORIES:\n${memoriesText}\n\nQUESTION: ${query}`;

      // Attempt to enrich system prompt with graph context (primary source for relationship queries)
      let graphSummary = "";
      try {
        console.log("[ASK USER ID]", getFridayUserId());
        console.log("[ASK QUERY]", query);
        const ctx = await getGraphService().buildQueryContext(
          getFridayUserId(), query, embeddingVec, 8,
        );
        console.log("========== GRAPH CONTEXT ==========");
        console.log(ctx);
        console.log("===================================");
        if (ctx.summary) graphSummary = ctx.summary;
      } catch {
        // Graph context is best-effort — never fail Ask Friday
      }

      const systemPrompt = buildSystemPrompt(graphSummary || undefined);
      console.log("[GRAPH SUMMARY SENT TO LLM]", graphSummary || "(none)");

      const raw = await getAIRouter().generate("ask_friday", systemPrompt, userPrompt, {
        maxTokens: 700,
        temperature: 0.3,
      });
      let answer = raw.trim();
      let cited_ids: string[] = [];

      const jsonMatch = raw.match(/\{"cited_ids":\s*\[[\s\S]*?\]\}/);
      if (jsonMatch) {
        try {
          const parsedCitations = JSON.parse(jsonMatch[0]) as { cited_ids: string[] };
          cited_ids = parsedCitations.cited_ids ?? [];
          answer = raw.replace(jsonMatch[0], "").trim();
        } catch { /* keep full answer */ }
      }

      const citations: CitedMemory[] = memories
        .filter((m) => cited_ids.includes(m.id))
        .map((m) => ({
          id: m.id,
          content: m.content,
          created_at: m.created_at,
          intent_tag: m.intent_tag,
          similarity: m.final_score,
          final_score: m.final_score,
          semantic_score: m.semantic_score,
          keyword_score: m.keyword_score,
          entity_score: m.entity_score,
          recency_score: m.recency_score,
          matched_entities: m.matched_entities,
        }));

      return reply.send({
        answer,
        citations,
        cited_ids,
        query_type: analysis.queryType,
        entities_detected: entities.map((e) => e.name),
      } satisfies AskResponse);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Ask Friday failed.";
      console.error("[memory/ask] error:", err);
      return reply.code(500).send({ error: message });
    }
  });
}
