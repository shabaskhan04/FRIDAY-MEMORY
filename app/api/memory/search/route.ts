import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase";
import { analyzeQuery } from "@/lib/queryAnalyzer";
import { recencyScore } from "@/lib/recency"; // flat 2-tier: 1.0 (<30d) or 0.9

export const runtime = "nodejs";

const EMBEDDING_MODEL      = "text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 1536;
const ENTITY_BOOST         = 0.4;

interface SearchRequestBody {
  query?: string;
  limit?: number;
  debug?: boolean;
}

export interface HybridMemoryRow {
  id: string;
  content: string;
  created_at: string;
  intent_tag: string | null;
  local_timezone: string | null;
  location_text: string | null;
  semantic_score: number;
  keyword_score: number;
  entity_score: number;
  recency_score: number;
  final_score: number;
  similarity: number;          // alias of final_score — keeps UI compat
  matched_entities: string[];
}


function normalizeLimit(limit: unknown): number {
  if (typeof limit !== "number" || !Number.isFinite(limit)) return 20;
  return Math.min(Math.max(Math.floor(limit), 1), 50);
}

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

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: SearchRequestBody;
  try {
    body = (await request.json()) as SearchRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const query = body.query?.trim() ?? "";
  if (!query) return NextResponse.json({ memories: [] }, { status: 200 });

  const limit = normalizeLimit(body.limit);
  const debug = Boolean(body.debug);

  try {
    const supabase = createClient();

    // 1. Analyze query: type + entities + dynamic weights
    const analysis = await analyzeQuery(query, supabase);
    const { weights, entities } = analysis;

    // 2. Embed the query
    const embedding = await generateQueryEmbedding(query);

    // 3. Call hybrid search RPC
    // entity_weight is applied in app layer; pass it as 0 to SQL so we don't double-count
    const { data, error } = await supabase.rpc("match_memories_hybrid", {
      query_embedding: toVectorLiteral(embedding),
      query_text:      query,
      semantic_weight: weights.semantic,
      keyword_weight:  weights.keyword,
      recency_weight:  weights.recency,
      match_count:     Math.min(limit * 3, 50), // fetch extra for entity re-ranking
      match_threshold: -1,
    });

    if (error) {
      console.error("[memory/search] hybrid RPC failed:", error);
      return NextResponse.json({ error: "Search failed.", detail: error.message }, { status: 500 });
    }

    type RpcRow = {
      id: string; content: string; created_at: string;
      intent_tag: string | null; local_timezone: string | null;
      location_text: string | null;
      semantic_score: number; keyword_score: number;
      recency_score: number; final_score: number;
    };

    const rows = (data ?? []) as RpcRow[];

    // 4. Apply entity boosting in app layer
    const entityNames = entities.map((e) => e.name.toLowerCase());

    const scored: HybridMemoryRow[] = rows.map((row) => {
      const contentLower = row.content.toLowerCase();
      const matched = entityNames.filter((n) => contentLower.includes(n));
      const entityScore = Math.min(matched.length * ENTITY_BOOST, 1.0);

      const finalScore =
        row.semantic_score * weights.semantic +
        row.keyword_score  * weights.keyword  +
        entityScore        * weights.entity   +
        row.recency_score  * weights.recency;

      return {
        ...row,
        entity_score:    entityScore,
        final_score:     finalScore,
        similarity:      finalScore,  // kept for UI backwards compat
        matched_entities: matched,
      };
    });

    // Re-sort after entity boost, take final limit
    scored.sort((a, b) => b.final_score - a.final_score);
    const results = scored.slice(0, limit);

    const response: Record<string, unknown> = { memories: results };
    if (debug) {
      response.query_analysis = {
        query_type: analysis.queryType,
        entities:   analysis.entities,
        weights:    analysis.weights,
      };
    }

    return NextResponse.json(response, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Hybrid search failed.";
    console.error("[memory/search] error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
