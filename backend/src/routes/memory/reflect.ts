import type { FastifyInstance } from "fastify";
import { getAIRouter } from "../../lib/intelligence";
import { generateEmbedding, toVectorLiteral } from "../../lib/embeddings";
import { createServiceClient } from "../../lib/supabase";
import type { ReflectRequestBody, ReflectResponse } from "@friday/shared";

const REFLECTION_SYSTEM_PROMPT = `You are Friday's introspection engine. Analyse the batch of recent memories provided and extract 3–7 meaningful insights about the user's life, patterns, and state.

For each insight output a JSON object. Return ONLY a JSON array — no markdown, no explanation:
[
  {
    "type": "pattern" | "emotion" | "relationship" | "goal" | "risk",
    "content": "One clear, specific insight sentence.",
    "source_memory_ids": ["uuid1", "uuid2"]
  }
]`;

/**
 * Core reflection logic — shared by the API route AND the PM2 cron worker.
 */
export async function runReflection(hoursBack = 24): Promise<ReflectResponse> {
  const supabase = createServiceClient();

  const since = new Date(Date.now() - hoursBack * 3600 * 1000).toISOString();

  const { data: memories, error: fetchError } = await supabase
    .from("raw_ledgers")
    .select("id, content, created_at, intent_tag")
    .gte("created_at", since)
    .order("created_at", { ascending: false });

  if (fetchError) throw new Error(`Fetch error: ${fetchError.message}`);
  if (!memories || memories.length < 3) {
    return { status: "skipped", reason: "Not enough memories to reflect on (< 3)." };
  }

  const memoryBlock = memories
    .map((m) => `[${m.id}] (${m.intent_tag ?? "standard"}) ${m.content}`)
    .join("\n\n");

  const raw = await getAIRouter().generate(
    "daily_reflection",
    REFLECTION_SYSTEM_PROMPT,
    `Memories from the last ${hoursBack}h:\n\n${memoryBlock}`,
    { temperature: 0.4, maxTokens: 1024 }
  );
  const cleaned = raw.replace(/```json|```/g, "").trim();

  type InsightRaw = { type: string; content: string; source_memory_ids: string[] };
  let insights: InsightRaw[];
  try {
    insights = JSON.parse(cleaned) as InsightRaw[];
    if (!Array.isArray(insights)) insights = [];
  } catch {
    console.error("[reflect] Failed to parse Groq JSON:", raw);
    return { status: "skipped", reason: "Groq returned malformed JSON." };
  }

  let saved = 0;

  await Promise.all(
    insights.map(async (insight) => {
      if (!insight.content?.trim()) return;

      const embedding = await generateEmbedding(insight.content);

      const { error: insertError } = await supabase.rpc("insert_reflection", {
        p_type: insight.type ?? "pattern",
        p_content: insight.content.trim(),
        p_source_memory_ids: insight.source_memory_ids ?? [],
        p_embedding: embedding ? toVectorLiteral(embedding) : null,
      });

      if (insertError) {
        console.error("[reflect] insert_reflection error:", insertError.message);
      } else {
        saved++;
      }
    })
  );

  return { status: "ok", insights_saved: saved };
}

export async function memoryReflectRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: ReflectRequestBody }>("/memory/reflect", async (request, reply) => {
    const hoursBack = typeof request.body.hours_back === "number"
      ? Math.min(Math.max(request.body.hours_back, 1), 168)
      : 24;

    try {
      const result = await runReflection(hoursBack);
      return reply.send(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Reflection failed.";
      console.error("[memory/reflect] error:", err);
      return reply.code(500).send({ error: message });
    }
  });
}
