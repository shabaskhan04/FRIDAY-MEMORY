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
   - "Shabeera (mother)" → name = "Shabeera"
   - "my sister Sharmin" → name = "Sharmin"
   - "Sharmin (sister)" → name = "Sharmin"
2. Use the FULL name whenever available. If only a role word appears (dad, mom, sister) with no real name in the text, use that role as the name (e.g. "Dad").
3. The relationship belongs in interaction_type and ledger_note — NEVER in the name field.
4. If the same person is mentioned multiple times in the transcript, emit only ONE entity_update for them.
5. interaction_type must be exactly: "family" | "friend" | "business" | "conflict"
   - family: parents, siblings, spouse, relatives
   - friend: peers, acquaintances
   - business: colleagues, clients, professional contacts
   - conflict: adversarial relationships

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
// (safety net in case the AI still returns "Name (role)")
// ============================================================

function canonicalizeName(raw: string): string {
  // Remove parenthetical role suffixes: "Shanavas Khan (father)" -> "Shanavas Khan"
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

  // ── 2. Groq — structured JSON extraction ──────────────────

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

  // Canonicalize names — strip "(role)" suffixes the AI may have included,
  // then deduplicate by canonical lowercase name within this single ingest
  const rawEntityUpdates: EntityUpdate[] = Array.isArray(parsed.entity_updates)
    ? parsed.entity_updates
    : [];

  const seenNames = new Set<string>();
  const entityUpdates: EntityUpdate[] = [];
  for (const e of rawEntityUpdates) {
    const cleanName = canonicalizeName(e.name ?? "");
    if (!cleanName) continue;
    const key = cleanName.toLowerCase();
    if (seenNames.has(key)) continue; // deduplicate within same ingest
    seenNames.add(key);
    entityUpdates.push({ ...e, name: cleanName });
  }

  const extractedTasks: string[] = Array.isArray(parsed.extracted_tasks)
    ? parsed.extracted_tasks.filter(
        (t): t is string => typeof t === "string" && t.trim().length > 0
      )
    : [];

  // ── 4. Immutable write → raw_ledgers ──────────────────────

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
