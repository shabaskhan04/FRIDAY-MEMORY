import { NextRequest, NextResponse } from "next/server";
import Groq from "groq-sdk";
import { createClient } from "@/lib/supabase";

// ============================================================
// Types
// ============================================================

type IntentTag = "standard" | "spark" | "friction";
type DeviceType = "mobile" | "desktop";

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
  intent_tag: IntentTag;
  temporal_events: TemporalEvent[];
  entity_updates: EntityUpdate[];
  extracted_tasks: string[];
}

interface IngestRequestBody {
  content: string;
  device_type?: DeviceType;
  local_timezone?: string;
  location_text?: string;
  location_lat?: number;
  location_lon?: number;
}

// ============================================================
// System prompt — v3: auto intent-tag detection
// ============================================================

const SYSTEM_PROMPT = `You are a cognitive routing engine. Take the user's unstructured transcript and extract it into a strict JSON schema. The user will mix past, present, and future events, mention people, and describe goals or actions.

Determine the intent_tag based on:
- "spark": excited, inspired, creative, breakthrough, new idea, energized, happy
- "friction": stressed, frustrated, worried, conflict, problem, issue, negative emotion
- "standard": neutral, factual, informational, routine

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
      "name": "Name of person or organisation",
      "interaction_type": "business" | "friend" | "family" | "conflict",
      "trust_signal": "positive" | "negative" | "neutral",
      "ledger_note": "What was learned about this entity"
    }
  ],
  "extracted_tasks": [
    "A clean, direct, actionable to-do step parsed explicitly from the goals, requirements, or operational updates mentioned in the transcript. Each item must be a single self-contained action sentence. If no clear actions are detected, return an empty array []."
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
  // ── 1. Parse & validate body ───────────────────────────────

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

  const deviceType: DeviceType | null =
    body.device_type && ["mobile", "desktop"].includes(body.device_type)
      ? body.device_type
      : null;

  const localTimezone: string | null = body.local_timezone?.trim() ?? null;
  const locationText: string | null = body.location_text?.trim() ?? null;
  const locationLat: number | null = typeof body.location_lat === "number" ? body.location_lat : null;
  const locationLon: number | null = typeof body.location_lon === "number" ? body.location_lon : null;

  const supabase = createClient();

  // ── 2. Groq — structured JSON extraction (v3 payload) ─────

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
    const message =
      groqError instanceof Error ? groqError.message : "Groq SDK error.";
    console.error("[ingest] Groq call failed:", groqError);
    return NextResponse.json({ error: message }, { status: 502 });
  }

  // ── 3. Parse structured payload ────────────────────────────

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

  // Validate intent_tag from AI
  const intentTag: IntentTag =
    parsed.intent_tag && ["standard", "spark", "friction"].includes(parsed.intent_tag)
      ? parsed.intent_tag
      : "standard";

  const temporalEvents: TemporalEvent[] = Array.isArray(parsed.temporal_events)
    ? parsed.temporal_events
    : [];

  const entityUpdates: EntityUpdate[] = Array.isArray(parsed.entity_updates)
    ? parsed.entity_updates
    : [];

  const extractedTasks: string[] = Array.isArray(parsed.extracted_tasks)
    ? parsed.extracted_tasks.filter(
        (t): t is string => typeof t === "string" && t.trim().length > 0
      )
    : [];

  // ── 4. Immutable write → raw_ledgers (with all context) ──

  // Build insert payload — location columns are optional (added by migration)
  const ledgerInsert: Record<string, unknown> = {
    content,
    intent_tag: intentTag,
    device_type: deviceType,
    local_timezone: localTimezone,
  };
  if (locationText) ledgerInsert.location_text = locationText;
  if (locationLat !== null) ledgerInsert.location_lat = locationLat;
  if (locationLon !== null) ledgerInsert.location_lon = locationLon;

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

  // ── 5. Concurrent writes: temporal + entity + tasks ────────

  const [temporalResult, entityResult, taskResult] = await Promise.all([
    // Temporal memories
    temporalEvents.length > 0
      ? supabase.from("temporal_memories").insert(
          temporalEvents.map((e) => ({
            raw_ledger_id: rawLedgerId,
            time_horizon: e.time_horizon,
            estimated_date: e.estimated_date ?? null,
            era: e.era ?? null,
            event_summary: e.event_summary ?? null,
          }))
        )
      : Promise.resolve({ error: null }),

    // Entity ledger
    entityUpdates.length > 0
      ? supabase.from("entity_ledger").insert(
          entityUpdates.map((e) => ({
            raw_ledger_id: rawLedgerId,
            name: e.name,
            interaction_type: e.interaction_type ?? null,
            trust_signal: e.trust_signal,
            ledger_note: e.ledger_note ?? null,
          }))
        )
      : Promise.resolve({ error: null }),

    // To-do tasks — batch insert all extracted action steps
    extractedTasks.length > 0
      ? supabase.from("todo_tasks").insert(
          extractedTasks.map((task) => ({
            raw_ledger_id: rawLedgerId,
            task_description: task.trim(),
            status: "pending",
          }))
        )
      : Promise.resolve({ error: null }),
  ]);

  if (temporalResult.error)
    console.error("[ingest] temporal_memories error:", temporalResult.error);
  if (entityResult.error)
    console.error("[ingest] entity_ledger error:", entityResult.error);
  if (taskResult.error)
    console.error("[ingest] todo_tasks error:", taskResult.error);

  // ── 6. 200 success ─────────────────────────────────────────

  return NextResponse.json(
    {
      success: true,
      raw_ledger_id: rawLedgerId,
      intent_tag: intentTag,
      temporal_count: temporalEvents.length,
      entity_count: entityUpdates.length,
      task_count: extractedTasks.length,
    },
    { status: 200 }
  );
}
