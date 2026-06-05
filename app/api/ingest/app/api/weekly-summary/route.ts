import { NextResponse } from "next/server";
import Groq from "groq-sdk";
import { createClient } from "@/lib/supabase";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const WEEKLY_PROMPT = `You are a personal cognitive coach reviewing someone's week of recorded memories, events, people interactions, and tasks.

Analyse the data and output EXACTLY this JSON (no markdown, no extra keys):
{
  "mood_summary": "One sentence describing the overall emotional tone of the week",
  "what_to_do": ["Concrete actionable step 1", "Concrete actionable step 2", "..."],
  "what_to_avoid": ["Specific thing to avoid 1", "Specific thing to avoid 2", "..."],
  "what_to_improve": ["Area of improvement 1", "Area of improvement 2", "..."],
  "key_people": ["Person worth engaging with this week and why (one string each)"],
  "pending_focus": ["Most important pending task or goal to focus on"]
}

Each array should have 2-4 items. Be specific to the data provided, not generic.`;

export async function GET(): Promise<NextResponse> {
  try {
    const supabase = createClient();

    // Get start/end of current week (Monday to Sunday)
    const now = new Date();
    const dayOfWeek = now.getDay(); // 0=Sun, 1=Mon...
    const monday = new Date(now);
    monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
    monday.setHours(0, 0, 0, 0);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);

    const weekStart = monday.toISOString();
    const weekEnd = sunday.toISOString();

    // Fetch all week data in parallel
    const [rawRes, entityRes, todoRes, temporalRes] = await Promise.all([
      supabase
        .from("raw_ledgers")
        .select("id, content, intent_tag, created_at, local_timezone")
        .gte("created_at", weekStart)
        .lte("created_at", weekEnd)
        .order("created_at", { ascending: true }),
      supabase
        .from("entity_ledger")
        .select("name, interaction_type, trust_signal, ledger_note, raw_ledger_id"),
      supabase
        .from("todo_tasks")
        .select("task_description, status, created_at")
        .order("created_at", { ascending: false }),
      supabase
        .from("temporal_memories")
        .select("time_horizon, estimated_date, era, event_summary, raw_ledger_id")
        .gte("estimated_date", weekStart.split("T")[0]),
    ]);

    const rawLedgers = rawRes.data ?? [];
    const entities = entityRes.data ?? [];
    const todos = todoRes.data ?? [];
    const temporals = temporalRes.data ?? [];

    if (rawLedgers.length === 0 && todos.length === 0) {
      return NextResponse.json({
        mood_summary: "No data recorded this week yet.",
        what_to_do: ["Start recording your thoughts and activities"],
        what_to_avoid: [],
        what_to_improve: ["Build a habit of daily memory capture"],
        key_people: [],
        pending_focus: [],
        week_start: weekStart,
        week_end: weekEnd,
        entry_count: 0,
      }, { status: 200 });
    }

    // Build context string for Groq
    const weekContext = [
      `=== WEEK: ${monday.toDateString()} to ${sunday.toDateString()} ===`,
      `=== MEMORIES (${rawLedgers.length}) ===`,
      rawLedgers.map((r, i) =>
        `[${i + 1}] [${r.intent_tag?.toUpperCase() ?? "STANDARD"}] ${new Date(r.created_at as string).toLocaleString()}: ${r.content}`
      ).join("\n"),
      `=== PEOPLE INTERACTIONS (${entities.length}) ===`,
      entities.map((e) =>
        `- ${e.name} (${e.interaction_type}, ${e.trust_signal}): ${e.ledger_note}`
      ).join("\n"),
      `=== TODOS ===`,
      `Pending: ${todos.filter((t) => t.status === "pending").map((t) => t.task_description).join("; ")}`,
      `Done: ${todos.filter((t) => t.status === "done").map((t) => t.task_description).join("; ")}`,
      `=== UPCOMING EVENTS ===`,
      temporals.filter((t) => t.time_horizon === "future").map((t) =>
        `- [${t.estimated_date}] ${t.event_summary}`
      ).join("\n"),
    ].join("\n\n");

    // Call Groq
    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      response_format: { type: "json_object" },
      temperature: 0.3,
      max_tokens: 1024,
      messages: [
        { role: "system", content: WEEKLY_PROMPT },
        { role: "user", content: weekContext },
      ],
    });

    const rawJson = completion.choices[0]?.message?.content ?? "{}";
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(rawJson) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: "AI returned malformed JSON." }, { status: 500 });
    }

    return NextResponse.json({
      ...parsed,
      week_start: weekStart,
      week_end: weekEnd,
      entry_count: rawLedgers.length,
      people_count: entities.length,
      pending_todos: todos.filter((t) => t.status === "pending").length,
    }, { status: 200 });
  } catch (err) {
    console.error("[weekly-summary] error:", err);
    return NextResponse.json({ error: "Internal server error." }, { status: 500 });
  }
}
