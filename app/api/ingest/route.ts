import { NextRequest, NextResponse } from "next/server";
import Groq from "groq-sdk";
import { createClient } from "@/lib/supabase";

// ============================================================
// Types
// ============================================================

interface TemporalEvent {
  time_horizon: "past" | "present" | "future";
  estimated_date: string;
  era: string;
  event_summary: string;
}

interface EntityUpdate {
  name: string;
  interaction_type: string;
  trust_signal: "positive" | "negative" | "neutral";
  ledger_note: string;
}

interface GroqRouterPayload {
  temporal_events: TemporalEvent[];
  entity_updates: EntityUpdate[];
}

interface IngestRequestBody {
  content: string;
}

// ============================================================
// System prompt for Groq cognitive routing
// ============================================================

const SYSTEM_PROMPT = `You are a cognitive routing engine. Take the user's unstructured transcript and extract it into a strict JSON schema. The user will mix past, present, and future events, and mention people.

Output EXACTLY this JSON format:
{
  "temporal_events": [
    {
      "time_horizon": "past" | "present" | "future",
      "estimated_date": "YYYY-MM-DD or contextual guess",
      "era": "Infer the life chapter",
      "event_summary": "Structured summary"
    }
  ],
  "entity_updates": [
    {
      "name": "Name of person",
      "interaction_type": "business" | "friend" | "family" | "conflict",
      "trust_signal": "positive" | "negative" | "neutral",
      "ledger_note": "What did we learn about this person?"
    }
  ]
}`;

// ============================================================
// Groq SDK — singleton at module scope
// ============================================================

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ============================================================
// POST /api/ingest
// ============================================================

export async function POST(request: NextRequest): Promise<NextResponse> {
  // ── 1. Parse body ─────────────────────────────────────────
  let body: IngestRequestBody;
  try {
    body = (await request.json()) as IngestRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const content = body.content?.trim();
  if (!content) {
    return NextResponse.json(
      { error: "content is required and must not be empty." },
      { status: 400 }
    );
  }

  const supabase = createClient();

  // ── 2. Immutable write → raw_ledgers ──────────────────────
  const { data: ledgerData, error: ledgerError } = await supabase
    .from("raw_ledgers")
    .insert({ content })
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

  // ── 3. Groq — structured JSON extraction ──────────────────
  let groqRawJson: string;
  try {
    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      response_format: { type: "json_object" },
      temperature: 0.2,
      max_tokens: 2048,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content },
      ],
    });
    groqRawJson = completion.choices[0]?.message?.content ?? "{}";
  } catch (groqError: unknown) {
    const message = groqError instanceof Error ? groqError.message : "Groq SDK error.";
    console.error("[ingest] Groq call failed:", groqError);
    return NextResponse.json({ error: message }, { status: 502 });
  }

  // ── 4. Parse structured payload ───────────────────────────
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

  const temporalEvents: TemporalEvent[] = Array.isArray(parsed.temporal_events)
    ? parsed.temporal_events
    : [];

  const entityUpdates: EntityUpdate[] = Array.isArray(parsed.entity_updates)
    ? parsed.entity_updates
    : [];

  // ── 5. Concurrent writes ───────────────────────────────────
  const [temporalResult, entityResult] = await Promise.all([
    temporalEvents.length > 0
      ? supabase.from("temporal_memories").insert(
          temporalEvents.map((e) => ({
            raw_ledger_id:  rawLedgerId,
            time_horizon:   e.time_horizon,
            estimated_date: e.estimated_date ?? null,
            era:            e.era ?? null,
            event_summary:  e.event_summary ?? null,
          }))
        )
      : Promise.resolve({ error: null }),

    entityUpdates.length > 0
      ? supabase.from("entity_ledger").insert(
          entityUpdates.map((e) => ({
            raw_ledger_id:    rawLedgerId,
            name:             e.name,
            interaction_type: e.interaction_type ?? null,
            trust_signal:     e.trust_signal,
            ledger_note:      e.ledger_note ?? null,
          }))
        )
      : Promise.resolve({ error: null }),
  ]);

  if (temporalResult.error)
    console.error("[ingest] temporal_memories error:", temporalResult.error);
  if (entityResult.error)
    console.error("[ingest] entity_ledger error:", entityResult.error);

  // ── 6. 200 success ────────────────────────────────────────
  return NextResponse.json(
    {
      success:        true,
      raw_ledger_id:  rawLedgerId,
      temporal_count: temporalEvents.length,
      entity_count:   entityUpdates.length,
    },
    { status: 200 }
  );
}
