import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase";

export const runtime = "nodejs";

interface SearchRequestBody {
  query?: string;
  limit?: number;
}

interface OpenAIEmbeddingResponse {
  data: Array<{ embedding: number[] }>;
}

interface SemanticMemoryRow {
  id: string;
  raw_ledger_id: string;
  content: string;
  created_at: string;
  intent_tag: string | null;
  local_timezone: string | null;
  location_text: string | null;
  similarity: number;
}

const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 1536;

function normalizeLimit(limit: unknown): number {
  if (typeof limit !== "number" || !Number.isFinite(limit)) return 20;
  return Math.min(Math.max(Math.floor(limit), 1), 50);
}

function toVectorLiteral(vector: number[]): string {
  return `[${vector.join(",")}]`;
}

async function generateQueryEmbedding(query: string): Promise<number[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: query,
    }),
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(`OpenAI embedding request failed: ${response.status} ${errorBody}`);
  }

  const json = (await response.json()) as OpenAIEmbeddingResponse;
  const embedding = json.data[0]?.embedding;
  if (!Array.isArray(embedding) || embedding.length !== EMBEDDING_DIMENSIONS) {
    throw new Error("OpenAI returned an invalid embedding vector.");
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
  if (!query) {
    return NextResponse.json({ memories: [] }, { status: 200 });
  }

  try {
    const limit = normalizeLimit(body.limit);
    const embedding = await generateQueryEmbedding(query);
    const supabase = createClient();

    const { data, error } = await supabase.rpc("match_memories", {
      query_embedding: toVectorLiteral(embedding),
      match_count: limit,
      match_threshold: -1,
    });

    if (error) {
      console.error("[memory/search] match_memories RPC failed:", error);
      return NextResponse.json(
        {
          error: "Semantic search is not ready.",
          detail: error.message,
        },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { memories: (data ?? []) as SemanticMemoryRow[] },
      { status: 200 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Semantic search failed.";
    console.error("[memory/search] error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
