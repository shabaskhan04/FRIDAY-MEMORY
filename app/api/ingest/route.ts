import { NextRequest, NextResponse } from "next/server";
import Groq from "groq-sdk";
import { createClient } from "@/lib/supabase";

// ============================================================
// Types
// ============================================================

type IntentTag = "standard" | "spark" | "friction";
type DeviceType = "mobile" | "desktop";

/**
 * A single temporal event extracted from the raw content by Groq.
 */
interface TemporalEvent {
  time_horizon: "past" | "present" | "future";
  estimated_date: string;
  era: string;
  event_summary: string;
}

/**
 * A named entity extracted from the raw content by Groq.
 */
interface EntityUpdate {
  name: string;
  interaction_type: string;
  trust_signal: "positive" | "negative" | "neutral";
  ledger_note: string;
}

/**
 * The complete structured payload returned by Groq's router.
 */
interface GroqRouterPayload {
  intent_tag: IntentTag;
  temporal_events: TemporalEvent[];
  entity_updates: EntityUpdate[];
  extracted_tasks: string[];
}

/**
 * Shape of the POST body expected from the client.
 */
interface IngestRequestBody {
  content: string;
  device_type?: DeviceType;
  local_timezone?: string;
  location_text?: string;
  location_lat?: number;
  location_lon?: number;
}

/**
 * Resolved result from the embedding provider.
 * A 1536-dimensional float array, or null if generation failed.
 */
type EmbeddingVector = number[] | null;

// ============================================================
// Embedding configuration
// ============================================================

/**
 * EMBEDDING PROVIDER SELECTION
 * ─────────────────────────────
 * Set EMBEDDING_PROVIDER in .env.local to choose your backend:
 *
 *   EMBEDDING_PROVIDER=ollama         → local Ollama server (free, default)
 *   EMBEDDING_PROVIDER=huggingface    → HuggingFace Inference API (free tier)
 *   EMBEDDING_PROVIDER=openai         → OpenAI text-embedding-3-small (paid)
 *
 * Companion env vars per provider:
 *
 *   Ollama:
 *     OLLAMA_BASE_URL=http://localhost:11434   (default)
 *     OLLAMA_EMBEDDING_MODEL=nomic-embed-text  (default; 768-dim)
 *     NOTE: nomic-embed-text is 768-dim. For 1536-dim use mxbai-embed-large.
 *           Update vector(1536) → vector(768) in SQL if using nomic-embed-text.
 *
 *   HuggingFace TEI (Text Embeddings Inference):
 *     HUGGINGFACE_API_URL=https://api-inference.huggingface.co/pipeline/feature-extraction/BAAI/bge-large-en-v1.5
 *     HUGGINGFACE_API_KEY=hf_your_token_here
 *
 *   OpenAI:
 *     OPENAI_API_KEY=sk-your_key_here
 *     OPENAI_EMBEDDING_MODEL=text-embedding-3-small  (default; 1536-dim)
 */
const EMBEDDING_PROVIDER: string =
  process.env.EMBEDDING_PROVIDER ?? "ollama";

// ============================================================
// Embedding generation helpers
// ============================================================

/**
 * Generate an embedding vector using a local Ollama instance.
 *
 * Required env vars:
 *   OLLAMA_BASE_URL        (default: http://localhost:11434)
 *   OLLAMA_EMBEDDING_MODEL (default: mxbai-embed-large — 1536-dim)
 *
 * Pull the model first: `ollama pull mxbai-embed-large`
 */
async function generateEmbeddingOllama(text: string): Promise<EmbeddingVector> {
  const baseUrl: string =
    process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
  const model: string =
    process.env.OLLAMA_EMBEDDING_MODEL ?? "mxbai-embed-large";

  const response = await fetch(`${baseUrl}/api/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, prompt: text }),
    // Abort if Ollama is unreachable (e.g. not running locally)
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    const errorBody: string = await response.text().catch(() => "");
    throw new Error(
      `[embedding/ollama] HTTP ${response.status}: ${errorBody}`
    );
  }

  const json = (await response.json()) as { embedding?: number[] };

  if (!Array.isArray(json.embedding) || json.embedding.length === 0) {
    throw new Error(
      "[embedding/ollama] Response did not contain a valid embedding array."
    );
  }

  return json.embedding;
}

/**
 * Generate an embedding vector using the HuggingFace Inference API
 * (or a self-hosted Text Embeddings Inference server).
 *
 * Required env vars:
 *   HUGGINGFACE_API_URL  Full endpoint URL for the model
 *   HUGGINGFACE_API_KEY  Bearer token (optional for public models)
 *
 * Default public model: BAAI/bge-large-en-v1.5 (1536-dim)
 * Endpoint example:
 *   https://api-inference.huggingface.co/pipeline/feature-extraction/BAAI/bge-large-en-v1.5
 */
async function generateEmbeddingHuggingFace(
  text: string
): Promise<EmbeddingVector> {
  const apiUrl: string =
    process.env.HUGGINGFACE_API_URL ??
    "https://api-inference.huggingface.co/pipeline/feature-extraction/BAAI/bge-large-en-v1.5";
  const apiKey: string | undefined = process.env.HUGGINGFACE_API_KEY;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  const response = await fetch(apiUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({ inputs: text }),
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) {
    const errorBody: string = await response.text().catch(() => "");
    throw new Error(
      `[embedding/huggingface] HTTP ${response.status}: ${errorBody}`
    );
  }

  // HuggingFace feature-extraction returns either:
  //   · number[]         — flat vector (single input, no pooling wrapper)
  //   · number[][]       — batch of vectors
  //   · number[][][]     — token-level embeddings (requires mean-pooling)
  const raw: unknown = await response.json();

  // Flat 1-D array → use directly
  if (
    Array.isArray(raw) &&
    raw.length > 0 &&
    typeof raw[0] === "number"
  ) {
    return raw as number[];
  }

  // 2-D array → first row is the sentence embedding
  if (
    Array.isArray(raw) &&
    raw.length > 0 &&
    Array.isArray(raw[0]) &&
    typeof (raw as number[][])[0][0] === "number"
  ) {
    return (raw as number[][])[0];
  }

  // 3-D token-level tensor → mean-pool over token dimension
  if (
    Array.isArray(raw) &&
    raw.length > 0 &&
    Array.isArray(raw[0]) &&
    Array.isArray((raw as number[][][])[0][0])
  ) {
    const tokenEmbeddings = (raw as number[][][])[0]; // shape: [tokens, dim]
    const dim: number = tokenEmbeddings[0].length;
    const summed: number[] = new Array<number>(dim).fill(0);
    for (const tokenVec of tokenEmbeddings) {
      for (let i = 0; i < dim; i++) {
        summed[i] += tokenVec[i];
      }
    }
    return summed.map((v) => v / tokenEmbeddings.length);
  }

  throw new Error(
    "[embedding/huggingface] Unexpected response shape from HuggingFace API."
  );
}

/**
 * Generate an embedding vector using the OpenAI Embeddings API.
 * Uses the standard OpenAI REST endpoint — no SDK dependency required.
 *
 * Required env vars:
 *   OPENAI_API_KEY          Your OpenAI secret key
 *   OPENAI_EMBEDDING_MODEL  (default: text-embedding-3-small — 1536-dim)
 */
async function generateEmbeddingOpenAI(text: string): Promise<EmbeddingVector> {
  const apiKey: string | undefined = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "[embedding/openai] OPENAI_API_KEY environment variable is not set."
    );
  }

  const model: string =
    process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small";

  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, input: text }),
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) {
    const errorBody: string = await response.text().catch(() => "");
    throw new Error(
      `[embedding/openai] HTTP ${response.status}: ${errorBody}`
    );
  }

  interface OpenAIEmbeddingResponse {
    data: Array<{ embedding: number[]; index: number; object: string }>;
    model: string;
    object: string;
    usage: { prompt_tokens: number; total_tokens: number };
  }

  const json = (await response.json()) as OpenAIEmbeddingResponse;

  if (
    !Array.isArray(json.data) ||
    json.data.length === 0 ||
    !Array.isArray(json.data[0].embedding)
  ) {
    throw new Error(
      "[embedding/openai] Response did not contain a valid embedding."
    );
  }

  return json.data[0].embedding;
}

/**
 * Top-level embedding dispatcher.
 * Routes to the correct provider based on EMBEDDING_PROVIDER env var.
 * Returns null (non-fatal) if embedding generation fails — the rest of
 * the ingest pipeline continues and only the vector is skipped.
 */
async function generateEmbedding(text: string): Promise<EmbeddingVector> {
  try {
    switch (EMBEDDING_PROVIDER) {
      case "huggingface":
        return await generateEmbeddingHuggingFace(text);
      case "openai":
        return await generateEmbeddingOpenAI(text);
      case "ollama":
      default:
        return await generateEmbeddingOllama(text);
    }
  } catch (err: unknown) {
    // Embedding is non-blocking — log and return null so the rest of
    // the ingest pipeline (Groq extraction, temporal writes, etc.) still succeeds.
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[ingest] Embedding generation failed (non-fatal): ${message}`);
    return null;
  }
}

// ============================================================
// System prompt — v4: canonical name extraction
// ============================================================

const SYSTEM_PROMPT = `You are a cognitive routing engine. Take the user's unstructured transcript and extract it into a strict JSON schema. The user will mix past, present, and future events, mention people, and describe goals or actions.

Determine the intent_tag based on:
- "spark": excited, inspired, creative, breakthrough, new idea, energized, happy
- "friction": stressed, frustrated, worried, conflict, problem, issue, negative emotion
- "standard": neutral, factual, informational, routine

CRITICAL NAME RULES — follow these exactly:
1. Extract the person's REAL NAME ONLY. Strip all role descriptors from the name field.
   - "Shanavas Khan (father)" → name = "Shanavas Khan"
   - "Shabeera (mother)"      → name = "Shabeera"
   - "my sister Sharmin"      → name = "Sharmin"
2. Use the FULL name whenever available. If only a role word appears (dad, mom, sister)
   with no real name in the text, use that role as the name (e.g. "Dad").
3. The relationship belongs in interaction_type and ledger_note — NEVER in the name field.
4. If the same person is mentioned multiple times in the transcript, emit only ONE entity_update.
5. interaction_type must be exactly: "family" | "friend" | "business" | "conflict"

Output EXACTLY this JSON format — no extra keys, no markdown:
{
  "intent_tag": "standard" | "spark" | "friction",
  "temporal_events": [
    {
      "time_horizon": "past" | "present" | "future",
      "estimated_date": "YYYY-MM-DD or contextual guess",
      "era": "Infer the life chapter or project phase",
      "event_summary": "Structured summary of the event"
    }
  ],
  "entity_updates": [
    {
      "name": "Clean real name only — NO role suffixes like (father) or (sister)",
      "interaction_type": "family" | "friend" | "business" | "conflict",
      "trust_signal": "positive" | "negative" | "neutral",
      "ledger_note": "What was learned — include relationship context here e.g. 'Father, supportive and hardworking'"
    }
  ],
  "extracted_tasks": [
    "A clean, direct, actionable to-do step. Each item must be a single self-contained action sentence. If no clear actions are detected, return an empty array []."
  ]
}`;

// ============================================================
// Groq SDK — singleton at module scope
// ============================================================

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ============================================================
// Helper: strip role suffixes from AI-extracted names
// Safety net: "Shanavas Khan (father)" → "Shanavas Khan"
// ============================================================

function canonicalizeName(raw: string): string {
  return raw.replace(/\s*\([^)]*\)\s*$/, "").trim();
}

// ============================================================
// POST /api/ingest
// ============================================================

export async function POST(request: NextRequest): Promise<NextResponse> {
  // ── 1. Parse & validate body ───────────────────────────────

  let body: IngestRequestBody;
  try {
    body = (await request.json()) as IngestRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const content: string = body.content?.trim() ?? "";
  if (!content) {
    return NextResponse.json(
      { error: "content is required and must not be empty." },
      { status: 400 }
    );
  }

  const deviceType: DeviceType | null =
    body.device_type && ["mobile", "desktop"].includes(body.device_type)
      ? body.device_type
      : null;

  const localTimezone: string | null = body.local_timezone?.trim() ?? null;
  const locationText: string | null  = body.location_text?.trim() ?? null;
  const locationLat: number | null   =
    typeof body.location_lat === "number" ? body.location_lat : null;
  const locationLon: number | null   =
    typeof body.location_lon === "number" ? body.location_lon : null;

  const supabase = createClient();

  // ── 2. Groq — structured JSON extraction ──────────────────
  // Run Groq extraction and embedding generation concurrently.
  // Both are independent of each other — no need to sequence them.

  let groqRawJson: string;
  let embeddingVector: EmbeddingVector;

  try {
    const [groqResult, embeddingResult] = await Promise.all([
      // Groq: structured metadata extraction
      groq.chat.completions.create({
        model: "llama-3.3-70b-versatile",
        response_format: { type: "json_object" },
        temperature: 0.2,
        max_tokens: 2048,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user",   content },
        ],
      }),
      // Embedding: vector generation (non-blocking — returns null on failure)
      generateEmbedding(content),
    ]);

    groqRawJson     = groqResult.choices[0]?.message?.content ?? "{}";
    embeddingVector = embeddingResult;
  } catch (groqError: unknown) {
    // If Groq itself fails (not the embedding), abort — we need the metadata.
    const message =
      groqError instanceof Error ? groqError.message : "Groq SDK error.";
    console.error("[ingest] Groq call failed:", groqError);
    return NextResponse.json({ error: message }, { status: 502 });
  }

  // ── 3. Parse structured Groq payload ──────────────────────

  let parsed: GroqRouterPayload;
  try {
    parsed = JSON.parse(groqRawJson) as GroqRouterPayload;
  } catch {
    console.error("[ingest] JSON parse failed. Raw output:", groqRawJson);
    return NextResponse.json(
      { error: "Groq returned malformed JSON." },
      { status: 500 }
    );
  }

  // Validate intent_tag
  const intentTag: IntentTag =
    parsed.intent_tag &&
    ["standard", "spark", "friction"].includes(parsed.intent_tag)
      ? parsed.intent_tag
      : "standard";

  // Validate temporal events
  const temporalEvents: TemporalEvent[] = Array.isArray(parsed.temporal_events)
    ? parsed.temporal_events
    : [];

  // Canonicalize and deduplicate entity names within this single ingest
  const rawEntityUpdates: EntityUpdate[] = Array.isArray(parsed.entity_updates)
    ? parsed.entity_updates
    : [];

  const seenNames = new Set<string>();
  const entityUpdates: EntityUpdate[] = [];
  for (const entity of rawEntityUpdates) {
    const cleanName: string = canonicalizeName(entity.name ?? "");
    if (!cleanName) continue;
    const dedupeKey: string = cleanName.toLowerCase();
    if (seenNames.has(dedupeKey)) continue;
    seenNames.add(dedupeKey);
    entityUpdates.push({ ...entity, name: cleanName });
  }

  // Validate extracted tasks
  const extractedTasks: string[] = Array.isArray(parsed.extracted_tasks)
    ? parsed.extracted_tasks.filter(
        (t): t is string => typeof t === "string" && t.trim().length > 0
      )
    : [];

  // ── 4. Immutable write → raw_ledgers ──────────────────────

  const ledgerInsert: Record<string, unknown> = {
    content,
    intent_tag:     intentTag,
    device_type:    deviceType,
    local_timezone: localTimezone,
  };
  if (locationText)         ledgerInsert.location_text = locationText;
  if (locationLat !== null) ledgerInsert.location_lat  = locationLat;
  if (locationLon !== null) ledgerInsert.location_lon  = locationLon;

  const { data: ledgerData, error: ledgerError } = await supabase
    .from("raw_ledgers")
    .insert(ledgerInsert)
    .select("id")
    .single();

  if (ledgerError || !ledgerData) {
    console.error("[ingest] raw_ledgers insert failed:", ledgerError);
    return NextResponse.json(
      { error: "Failed to commit to raw ledger." },
      { status: 500 }
    );
  }

  const rawLedgerId: string = ledgerData.id as string;

  // ── 5. Concurrent writes: temporal + entity + tasks + embedding ──
  //
  // All four writes are independent — run them in parallel.
  // The embedding write is conditional: only runs if a vector was generated.

  const embeddingWritePromise =
    embeddingVector !== null
      ? supabase
          .from("ledger_embeddings")
          .insert({
            raw_ledger_id: rawLedgerId,
            embedding: JSON.stringify(embeddingVector),
          })
          .then((res) => ({ error: res.error }))
      : Promise.resolve({ error: null });

  const temporalWritePromise: Promise<{ error: unknown }> =
    temporalEvents.length > 0
      ? Promise.resolve(
          supabase.from("temporal_memories").insert(
            temporalEvents.map((e) => ({
              raw_ledger_id:  rawLedgerId,
              time_horizon:   e.time_horizon,
              estimated_date: e.estimated_date ?? null,
              era:            e.era            ?? null,
              event_summary:  e.event_summary  ?? null,
            }))
          ).then((res) => ({ error: res.error }))
        )
      : Promise.resolve({ error: null });

  const entityWritePromise: Promise<{ error: unknown }> =
    entityUpdates.length > 0
      ? Promise.resolve(
          supabase.from("entity_ledger").insert(
            entityUpdates.map((e) => ({
              raw_ledger_id:    rawLedgerId,
              name:             e.name,
              interaction_type: e.interaction_type ?? null,
              trust_signal:     e.trust_signal,
              ledger_note:      e.ledger_note      ?? null,
            }))
          ).then((res) => ({ error: res.error }))
        )
      : Promise.resolve({ error: null });

  const taskWritePromise: Promise<{ error: unknown }> =
    extractedTasks.length > 0
      ? Promise.resolve(
          supabase.from("todo_tasks").insert(
            extractedTasks.map((task) => ({
              raw_ledger_id:    rawLedgerId,
              task_description: task.trim(),
              status:           "pending",
            }))
          ).then((res) => ({ error: res.error }))
        )
      : Promise.resolve({ error: null });

  const [temporalResult, entityResult, taskResult, embeddingResult] =
    await Promise.all([
      temporalWritePromise,
      entityWritePromise,
      taskWritePromise,
      embeddingWritePromise,
    ]);

  // Log non-fatal errors — none of these abort the 200 response
  if (temporalResult.error)
    console.error("[ingest] temporal_memories write error:", temporalResult.error);
  if (entityResult.error)
    console.error("[ingest] entity_ledger write error:", entityResult.error);
  if (taskResult.error)
    console.error("[ingest] todo_tasks write error:", taskResult.error);
  if (embeddingResult.error)
    console.error("[ingest] ledger_embeddings write error:", embeddingResult.error);

  // ── 6. Return success payload ──────────────────────────────

  return NextResponse.json(
    {
      success:         true,
      raw_ledger_id:   rawLedgerId,
      intent_tag:      intentTag,
      temporal_count:  temporalEvents.length,
      entity_count:    entityUpdates.length,
      task_count:      extractedTasks.length,
      // Inform the client whether a vector was stored
      embedding_stored: embeddingVector !== null && !embeddingResult.error,
    },
    { status: 200 }
  );
}