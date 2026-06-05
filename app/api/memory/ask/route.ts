import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase";
import Groq from "groq-sdk";

export const runtime = "nodejs";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 1536;

interface AskRequestBody {
  query?: string;
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

export interface CitedMemory {
  id: string;
  content: string;
  created_at: string;
  intent_tag: string | null;
  similarity: number;
}

export interface AskResponse {
  answer: string;
  citations: CitedMemory[];
  cited_ids: string[];
}

function toVectorLiteral(vector: number[]): string {
  return `[${vector.join(",")}]`;
}

async function generateQueryEmbedding(query: string): Promise<number[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured.");

  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
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

const SYSTEM_PROMPT = `You are Friday, a personal memory assistant. You will be given a list of the user's memories (numbered), and a question.

Your task:
1. Answer the question using ONLY the provided memories. Do not use outside knowledge.
2. Be direct, warm, and specific — reference concrete patterns you see.
3. At the end of your answer, include a JSON block (and nothing else after it) in this exact format:
   {"cited_ids": ["id1", "id2", ...]}
   Only cite the memory IDs that you actually used to construct the answer. Max 5 citations.
4. If the memories don't contain enough information to answer, say so honestly.

Format: 2-4 sentences of answer, then the JSON block on its own line.`;

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: AskRequestBody;
  try {
    body = (await request.json()) as AskRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const query = body.query?.trim() ?? "";
  if (!query) {
    return NextResponse.json({ error: "Query is required." }, { status: 400 });
  }

  try {
    // 1. Embed the query
    const embedding = await generateQueryEmbedding(query);
    const supabase = createClient();

    // 2. Retrieve top 10 semantically similar memories
    const { data, error } = await supabase.rpc("match_memories", {
      query_embedding: toVectorLiteral(embedding),
      match_count: 10,
      match_threshold: -1,
    });

    if (error) {
      return NextResponse.json(
        { error: "Memory retrieval failed.", detail: error.message },
        { status: 500 }
      );
    }

    const memories = (data ?? []) as SemanticMemoryRow[];

    if (memories.length === 0) {
      return NextResponse.json<AskResponse>({
        answer: "I don't have any memories that relate to this question yet. Add more memories and I'll be able to help.",
        citations: [],
        cited_ids: [],
      });
    }

    // 3. Build the prompt with numbered memories
    const memoriesText = memories
      .map((m, i) => {
        const date = new Date(m.created_at).toLocaleDateString("en-IN", {
          month: "short",
          day: "numeric",
          year: "numeric",
        });
        return `[${i + 1}] ID: ${m.id}\nDate: ${date}\nType: ${m.intent_tag ?? "memory"}\nContent: ${m.content}`;
      })
      .join("\n\n");

    const userMessage = `MEMORIES:\n${memoriesText}\n\nQUESTION: ${query}`;

    // 4. Call Groq LLM
    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      max_tokens: 600,
      temperature: 0.4,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? "";

    // 5. Parse the answer + cited_ids JSON
    let answer = raw.trim();
    let cited_ids: string[] = [];

    const jsonMatch = raw.match(/\{"cited_ids":\s*\[[\s\S]*?\]\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]) as { cited_ids: string[] };
        cited_ids = parsed.cited_ids ?? [];
        // Remove the JSON block from the visible answer
        answer = raw.replace(jsonMatch[0], "").trim();
      } catch {
        // If parsing fails, keep full answer with no citations
      }
    }

    // 6. Map cited IDs to full memory objects
    const citations: CitedMemory[] = memories
      .filter((m) => cited_ids.includes(m.id))
      .map((m) => ({
        id: m.id,
        content: m.content,
        created_at: m.created_at,
        intent_tag: m.intent_tag,
        similarity: m.similarity,
      }));

    return NextResponse.json<AskResponse>({ answer, citations, cited_ids });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Ask Friday failed.";
    console.error("[memory/ask] error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
