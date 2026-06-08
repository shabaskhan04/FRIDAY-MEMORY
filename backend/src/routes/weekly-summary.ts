import type { FastifyInstance } from "fastify";
import { createServiceClient } from "../lib/supabase";
import { getAIRouter } from "../lib/intelligence";
import type { WeeklySummary } from "@friday/shared";

const SUMMARY_SYSTEM_PROMPT = `You are Friday's weekly digest engine. Analyse the user's week of memories and produce a structured JSON summary.

Return ONLY valid JSON — no markdown, no preamble:
{
  "mood_summary": "2–3 sentence narrative of the week's emotional arc and major themes.",
  "what_to_do": ["Specific, actionable item 1", "..."],
  "what_to_avoid": ["Specific pattern or behaviour to avoid 1", "..."],
  "what_to_improve": ["Specific area for improvement 1", "..."],
  "key_people": ["Name 1", "Name 2"],
  "pending_focus": ["Most important pending priority 1", "..."]
}

Rules:
- Each list should have 2–4 items. Be specific — avoid generic advice.
- Base everything strictly on the data provided.
- key_people should be real names extracted from the memories.
- pending_focus should draw from the open todos provided.`;

/**
 * Core weekly summary logic — shared by the API route AND the PM2 digest worker.
 */
export async function generateWeeklySummary(): Promise<WeeklySummary> {
  const supabase = createServiceClient();

  const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();

  const [rawRes, temporalRes, entityRes, todoRes, activityRes, causalRes, decisionRes] = await Promise.all([
    supabase
      .from("raw_ledgers")
      .select("id, content, created_at, intent_tag")
      .gte("created_at", weekAgo)
      .order("created_at", { ascending: false }),
    supabase
      .from("temporal_memories")
      .select("event_summary, time_horizon, era, estimated_date")
      .gte("created_at", weekAgo)
      .order("estimated_date", { ascending: false }),
    supabase
      .from("entity_ledger")
      .select("name, interaction_type, trust_signal, ledger_note, raw_ledger_id"),
    supabase
      .from("todo_tasks")
      .select("task_description, status, created_at")
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("activities")
      .select("title, category, duration_mins, started_at")
      .gte("started_at", weekAgo)
      .order("started_at", { ascending: false }),
    supabase
      .from("causal_patterns")
      .select("cause_label, effect_label, pattern_type, confidence, status")
      .eq("status", "CONFIRMED")
      .order("confidence", { ascending: false })
      .limit(10),
    supabase
      .from("decisions")
      .select("title, expected_outcome, status, confidence_score, decision_date")
      .gte("decision_date", weekAgo)
      .order("decision_date", { ascending: false }),
  ]);

  const rawMemories = rawRes.data ?? [];
  const temporalEvents = temporalRes.data ?? [];
  const allEntities = entityRes.data ?? [];
  const todos = todoRes.data ?? [];
  const activities = activityRes.data ?? [];
  const patterns = causalRes.data ?? [];
  const decisions = decisionRes.data ?? [];

  // entity_ledger has no created_at — filter by raw_ledger_id membership in this week's memories
  const weekRawIds = new Set(rawMemories.map((m) => m.id as string));
  const entities = allEntities.filter((e) => weekRawIds.has((e as { raw_ledger_id: string }).raw_ledger_id));

  // Build context block for Groq
  const memoriesBlock =
    rawMemories.length === 0
      ? "No memories recorded this week."
      : rawMemories
          .slice(0, 40)
          .map(
            (m) =>
              `[${new Date(m.created_at as string).toLocaleDateString("en-IN")}] (${m.intent_tag ?? "standard"}) ${m.content}`
          )
          .join("\n");

  const temporalBlock =
    temporalEvents.length === 0
      ? ""
      : "\n\nTEMPORAL EVENTS:\n" +
        temporalEvents
          .slice(0, 10)
          .map((e) => `- ${e.era ?? ""}: ${e.event_summary}`)
          .join("\n");

  const entityBlock =
    entities.length === 0
      ? ""
      : "\n\nKEY PEOPLE MENTIONED:\n" +
        [
          ...new Map(
            entities.map((e) => [
              (e.name as string).toLowerCase(),
              `${e.name} (${e.interaction_type}, ${e.trust_signal})`,
            ])
          ).values(),
        ]
          .slice(0, 10)
          .join(", ");

  const todoBlock =
    todos.length === 0
      ? ""
      : "\n\nOPEN TODOS:\n" +
        todos
          .slice(0, 10)
          .map((t) => `- ${t.task_description}`)
          .join("\n");

  const activityBlock =
    activities.length === 0
      ? ""
      : "\n\nDAILY ACTIVITY CLUSTERS:\n" +
        activities
          .slice(0, 15)
          .map((a) => `- [${a.category}] ${a.title} (${a.duration_mins} mins)`)
          .join("\n");

  const patternBlock =
    patterns.length === 0
      ? ""
      : "\n\nCAUSAL INSIGHTS INFERRED:\n" +
        patterns
          .map((p) => `- ${p.cause_label} affects ${p.effect_label} (${p.pattern_type}, strength: ${p.confidence.toFixed(2)})`)
          .join("\n");

  const decisionBlock =
    decisions.length === 0
      ? ""
      : "\n\nDECISIONS MADE/RESOLVED:\n" +
        decisions
          .map((d) => `- ${d.title} (Status: ${d.status}, Expected outcome: ${d.expected_outcome ?? "unknown"})`)
          .join("\n");

  const prompt = `Week of ${new Date(weekAgo).toLocaleDateString("en-IN")} → ${new Date().toLocaleDateString("en-IN")}
Total memories: ${rawMemories.length}

MEMORIES:
${memoriesBlock}${temporalBlock}${entityBlock}${todoBlock}${activityBlock}${patternBlock}${decisionBlock}`;

  const raw = await getAIRouter().generate("weekly_review", SUMMARY_SYSTEM_PROMPT, prompt, {
    maxTokens: 1024,
    temperature: 0.3,
  });
  const cleaned = raw.replace(/```json|```/g, "").trim();

  type SummaryRaw = {
    mood_summary?: string;
    what_to_do?: string[];
    what_to_avoid?: string[];
    what_to_improve?: string[];
    key_people?: string[];
    pending_focus?: string[];
  };

  let parsed: SummaryRaw;
  try {
    parsed = JSON.parse(cleaned) as SummaryRaw;
  } catch {
    throw new Error("Groq returned malformed JSON for weekly summary.");
  }

  return {
    mood_summary: parsed.mood_summary ?? "Unable to generate summary.",
    what_to_do: parsed.what_to_do ?? [],
    what_to_avoid: parsed.what_to_avoid ?? [],
    what_to_improve: parsed.what_to_improve ?? [],
    key_people: parsed.key_people ?? [],
    pending_focus: parsed.pending_focus ?? [],
    week_start: weekAgo,
    week_end: new Date().toISOString(),
    entry_count: rawMemories.length,
    people_count: new Set(entities.map((e) => (e.name as string).replace(/\s*\([^)]*\)\s*$/, "").toLowerCase().trim())).size,
    pending_todos: todos.length,
  };
}

export async function weeklySummaryRoutes(app: FastifyInstance): Promise<void> {
  app.get("/weekly-summary", async (_request, reply) => {
    try {
      const summary = await generateWeeklySummary();
      return reply.send(summary);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Weekly summary failed.";
      console.error("[weekly-summary] error:", err);
      return reply.code(500).send({ error: message });
    }
  });
}
