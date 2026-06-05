import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase";
import { analyzeQuery, QueryAnalysis } from "@/lib/queryAnalyzer";
import Groq from "groq-sdk";

export const runtime = "nodejs";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const EMBEDDING_MODEL      = "text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 1536;
const ENTITY_BOOST         = 0.4;

interface AskRequestBody {
  query?: string;
  debug?: boolean;
}

export interface CitedMemory {
  id: string;
  content: string;
  created_at: string;
  intent_tag: string | null;
  similarity: number;
  // V2 additions
  final_score: number;
  semantic_score: number;
  keyword_score: number;
  entity_score: number;
  recency_score: number;
  matched_entities: string[];
}

export interface AskResponse {
  answer: string;
  citations: CitedMemory[];
  cited_ids: string[];
  // V2 additions
  query_type: string;
  entities_detected: string[];
}

// recency_score is computed by match_memories_hybrid SQL RPC using flat 2-tier
// logic: 1.0 for memories <30 days old, 0.9 for all older memories.
// Import recencyScore from search/route if needed outside SQL context.
function toVectorLiteral(v: number[]): string {
  return `[${v.join(",")}]`;
}

async function generateQueryEmbedding(query: string): Promise<number[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured.");

  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: query }),
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) {
    const err = await response.text().catch(() => "");
    throw new Error(`OpenAI embedding failed: ${response.status} ${err}`);
  }

  const json = await response.json() as { data: Array<{ embedding: number[] }> };
  const embedding = json.data[0]?.embedding;
  if (!Array.isArray(embedding) || embedding.length !== EMBEDDING_DIMENSIONS) {
    throw new Error("Invalid embedding returned.");
  }
  return embedding;
}

function buildSystemPrompt(): string {
  return `You are Friday, a personal memory assistant.

You will be given a list of the user's memories (numbered with IDs) and a question.

Your task:
1. Answer the question using ONLY the provided memories. Do not use outside knowledge.
2. Be direct, warm, and specific — reference concrete details from the memories.
3. When memories mention a specific person, project, or topic related to the question, prioritize those.
4. Identify recurring patterns across memories when relevant.
5. Include relevant dates or timeframes when available.
6. At the end of your answer, include a JSON block (and nothing else after it) in this exact format:
   {"cited_ids": ["id1", "id2", ...]}
   Only cite IDs you actually used. Max 5 citations.
7. If the memories don't contain enough information, say so honestly.
8. If the evidence is weak or indirect, note it.

Format: 2-4 sentences of answer, then the JSON block on its own line.`;
}

function buildUserPrompt(
  query: string,
  memories: ScoredRpcRow[],
  analysis: QueryAnalysis
): string {
  const entityContext = analysis.entities.length > 0
    ? `\nDetected in query: ${analysis.entities.map((e) => e.name).join(", ")}`
    : "";

  const memoriesText = memories
    .map((m, i) => {
      const date = new Date(m.created_at).toLocaleDateString("en-IN", {
        month: "short", day: "numeric", year: "numeric",
      });
      const entities = m.matched_entities.length > 0
        ? ` [mentions: ${m.matched_entities.join(", ")}]`
        : "";
      return `[${i + 1}] ID: ${m.id}\nDate: ${date}${entities}\nType: ${m.intent_tag ?? "memory"}\nContent: ${m.content}`;
    })
    .join("\n\n");

  return `Query: "${query}"
Query type: ${analysis.queryType}${entityContext}

MEMORIES:
${memoriesText}

QUESTION: ${query}`;
}

type ScoredRpcRow = {
  id: string; content: string; created_at: string;
  intent_tag: string | null; local_timezone: string | null;
  location_text: string | null;
  semantic_score: number; keyword_score: number;
  recency_score: number; final_score: number;
  entity_score: number; matched_entities: string[];
};

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: AskRequestBody;
  try {
    body = (await request.json()) as AskRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const query = body.query?.trim() ?? "";
  if (!query) return NextResponse.json({ error: "Query is required." }, { status: 400 });

  try {
    const supabase = createClient();

    // 1. Analyze query
    const analysis = await analyzeQuery(query, supabase);
    const { weights, entities } = analysis;
    const entityNames = entities.map((e) => e.name.toLowerCase());

    // 2. Embed
    const embedding = await generateQueryEmbedding(query);

    // 3. Hybrid retrieval
    const { data, error } = await supabase.rpc("match_memories_hybrid", {
      query_embedding: toVectorLiteral(embedding),
      query_text:      query,
      semantic_weight: weights.semantic,
      keyword_weight:  weights.keyword,
      recency_weight:  weights.recency,
      match_count:     30,
      match_threshold: -1,
    });

    if (error) {
      return NextResponse.json(
        { error: "Memory retrieval failed.", detail: error.message },
        { status: 500 }
      );
    }

    type RpcRow = {
      id: string; content: string; created_at: string;
      intent_tag: string | null; local_timezone: string | null;
      location_text: string | null;
      semantic_score: number; keyword_score: number;
      recency_score: number; final_score: number;
    };

    const rows = (data ?? []) as RpcRow[];

    // 4. Entity boost + re-rank
    const scored: ScoredRpcRow[] = rows.map((row) => {
      const contentLower = row.content.toLowerCase();
      const matched = entityNames.filter((n) => contentLower.includes(n));
      const entityScore = Math.min(matched.length * ENTITY_BOOST, 1.0);

      const finalScore =
        row.semantic_score * weights.semantic +
        row.keyword_score  * weights.keyword  +
        entityScore        * weights.entity   +
        row.recency_score  * weights.recency;

      return { ...row, entity_score: entityScore, final_score: finalScore, matched_entities: matched };
    });

    scored.sort((a, b) => b.final_score - a.final_score);
    const memories = scored.slice(0, 10);

    if (memories.length === 0) {
      return NextResponse.json<AskResponse>({
        answer: "I don't have any memories that relate to this question yet. Add more memories and I'll be able to help.",
        citations: [],
        cited_ids: [],
        query_type: analysis.queryType,
        entities_detected: entities.map((e) => e.name),
      });
    }

    // 5. Call Groq
    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      max_tokens: 700,
      temperature: 0.3,
      messages: [
        { role: "system", content: buildSystemPrompt() },
        { role: "user",   content: buildUserPrompt(query, memories, analysis) },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? "";

    // 6. Parse answer + cited_ids
    let answer = raw.trim();
    let cited_ids: string[] = [];

    const jsonMatch = raw.match(/\{"cited_ids":\s*\[[\s\S]*?\]\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]) as { cited_ids: string[] };
        cited_ids = parsed.cited_ids ?? [];
        answer = raw.replace(jsonMatch[0], "").trim();
      } catch { /* keep full answer */ }
    }

    // 7. Build citations
    const citations: CitedMemory[] = memories
      .filter((m) => cited_ids.includes(m.id))
      .map((m) => ({
        id:              m.id,
        content:         m.content,
        created_at:      m.created_at,
        intent_tag:      m.intent_tag,
        similarity:      m.final_score,
        final_score:     m.final_score,
        semantic_score:  m.semantic_score,
        keyword_score:   m.keyword_score,
        entity_score:    m.entity_score,
        recency_score:   m.recency_score,
        matched_entities: m.matched_entities,
      }));

    return NextResponse.json<AskResponse>({
      answer,
      citations,
      cited_ids,
      query_type:        analysis.queryType,
      entities_detected: entities.map((e) => e.name),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Ask Friday failed.";
    console.error("[memory/ask] error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
