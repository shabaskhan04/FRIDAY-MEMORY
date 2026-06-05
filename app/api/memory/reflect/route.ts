import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase";
import Groq from "groq-sdk";

export const runtime = "nodejs";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const EMBEDDING_MODEL      = "text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 1536;

interface RecentMemory {
  id: string;
  content: string;
  created_at: string;
  intent_tag: string | null;
}

interface ReflectionInsight {
  type: string;
  content: string;
  source_memory_ids: string[];
}

const REFLECTION_SYSTEM_PROMPT = `You are FRIDAY's reflection engine. Analyze today's memories and extract meaningful insights.

Return a JSON object with key "insights" containing an array. Each insight must have:
- "type": one of MOST_DISCUSSED_TOPIC, MOST_ACTIVE_PROJECT, REPEATED_CONCERN, EMERGING_GOAL, BEHAVIOR_PATTERN, DAILY_SUMMARY
- "content": 1-3 sentences describing the insight clearly and specifically
- "source_memory_ids": array of memory IDs (from the [ID:...] tags) that support this insight

Rules:
- DAILY_SUMMARY must always be present
- Other types only if clearly supported by the data
- Be specific, not generic
- Maximum 5 insights total
- Return ONLY valid JSON, no markdown, no explanation outside the JSON`;

async function generateEmbedding(text: string): Promise<number[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not configured.");

  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: text }),
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) throw new Error(`Embedding failed: ${response.status}`);

  const json = await response.json() as { data: Array<{ embedding: number[] }> };
  const embedding = json.data[0]?.embedding;
  if (!Array.isArray(embedding) || embedding.length !== EMBEDDING_DIMENSIONS) {
    throw new Error("Invalid embedding.");
  }
  return embedding;
}

async function runReflection(hoursBack = 24): Promise<{ insights: number; skipped?: boolean }> {
  const supabase = createClient();

  // 1. Fetch recent non-reflection memories
  const since = new Date(Date.now() - hoursBack * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from("raw_ledgers")
    .select("id, content, created_at, intent_tag")
    .gte("created_at", since)
    .or("is_reflection.is.null,is_reflection.eq.false")
    .order("created_at", { ascending: true })
    .limit(100);

  if (error) throw new Error(`Fetch failed: ${error.message}`);

  const memories = (data ?? []) as RecentMemory[];

  if (memories.length < 3) {
    return { insights: 0, skipped: true };
  }

  // 2. Build prompt
  const memoriesText = memories
    .map((m) => `[ID:${m.id}] (${m.created_at}) [${m.intent_tag ?? "memory"}]\n${m.content}`)
    .join("\n\n---\n\n");

  // 3. Call Groq
  const completion = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    response_format: { type: "json_object" },
    temperature: 0.4,
    max_tokens: 1500,
    messages: [
      { role: "system", content: REFLECTION_SYSTEM_PROMPT },
      { role: "user",   content: `Memories from the last ${hoursBack} hours (${memories.length} total):\n\n${memoriesText}` },
    ],
  });

  const raw = completion.choices[0]?.message?.content ?? "{}";

  let insights: ReflectionInsight[] = [];
  try {
    const parsed = JSON.parse(raw) as { insights?: ReflectionInsight[] };
    insights = Array.isArray(parsed.insights) ? parsed.insights : [];
  } catch {
    console.error("[reflect] Failed to parse Groq response:", raw);
    return { insights: 0 };
  }

  // 4. Save each insight as a memory with embedding
  let saved = 0;
  for (const insight of insights) {
    const reflectionContent = `[REFLECTION:${insight.type}] ${insight.content}`;

    try {
      const embedding = await generateEmbedding(reflectionContent);

      await supabase.rpc("insert_reflection", {
        p_content:         reflectionContent,
        p_embedding:       `[${embedding.join(",")}]`,
        p_reflection_type: insight.type,
        p_source_ids:      JSON.stringify(insight.source_memory_ids ?? []),
      });

      saved++;
    } catch (e) {
      console.error(`[reflect] Failed to save insight ${insight.type}:`, e);
    }
  }

  return { insights: saved };
}

// POST /api/memory/reflect — manual trigger
// Also safe to call from a Vercel cron job or edge scheduler
export async function POST(_request: NextRequest): Promise<NextResponse> {
  try {
    const result = await runReflection(24);

    if (result.skipped) {
      return NextResponse.json({ status: "skipped", reason: "Not enough memories to reflect on." });
    }

    return NextResponse.json({ status: "ok", insights_saved: result.insights });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Reflection failed.";
    console.error("[memory/reflect] error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// GET — health check / status
export async function GET(_request: NextRequest): Promise<NextResponse> {
  return NextResponse.json({ status: "ready", description: "POST to trigger a reflection run." });
}
